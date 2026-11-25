//! APFS のクローン (`cp -c` や Finder の複製で作られる、中身のブロックを共有するコピー) の情報。
//!
//! クローンどうしは中身を共有しているため、片方を消しても空きはほとんど増えない。
//! 重複の「消すと空く容量」の見込みをこれで補正する。
//!
//! macOS の `getattrlist` で次の 2 つを読む。
//! - `ATTR_CMNEXT_PRIVATESIZE`: 他のファイルと共有していない (消すと空く) 容量
//! - `ATTR_CMNEXT_CLONEID`: 中身のデータを表す ID。クローンどうしは同じ値になる
//!
//! macOS 以外や APFS 以外のボリューム、読めないファイルでは None を返す (補正しない)。

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloneInfo {
    /// 他のファイルと共有していない容量 (bytes)。割り当て単位で切り上げた値
    pub private_bytes: u64,
    /// クローンどうしで同じになる ID
    pub clone_id: u64,
}

#[cfg(target_os = "macos")]
pub fn clone_info(path: &Path) -> Option<CloneInfo> {
    use std::ffi::{c_char, c_void, CString};
    use std::os::unix::ffi::OsStrExt;

    // <sys/attr.h>
    const ATTR_BIT_MAP_COUNT: u16 = 5;
    const ATTR_CMN_RETURNED_ATTRS: u32 = 0x8000_0000;
    const ATTR_CMNEXT_PRIVATESIZE: u32 = 0x0000_0008;
    const ATTR_CMNEXT_CLONEID: u32 = 0x0000_0100;
    const FSOPT_NOFOLLOW: u32 = 0x0000_0001;
    /// forkattr を ATTR_CMNEXT_* として扱う
    const FSOPT_ATTR_CMN_EXTENDED: u32 = 0x0000_0020;

    #[repr(C)]
    struct AttrList {
        bitmapcount: u16,
        reserved: u16,
        commonattr: u32,
        volattr: u32,
        dirattr: u32,
        fileattr: u32,
        forkattr: u32,
    }

    extern "C" {
        fn getattrlist(
            path: *const c_char,
            attr_list: *mut c_void,
            attr_buf: *mut c_void,
            attr_buf_size: usize,
            options: u32,
        ) -> i32;
    }

    let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut req = AttrList {
        bitmapcount: ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: ATTR_CMN_RETURNED_ATTRS,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: ATTR_CMNEXT_PRIVATESIZE | ATTR_CMNEXT_CLONEID,
    };
    // 長さ (u32) + 返った属性の一覧 (u32 × 5) + PRIVATESIZE (off_t) + CLONEID (u64)
    let mut buf = [0u8; 64];
    // SAFETY: c_path は NUL 終端、req と buf は呼び出しの間生きていて、buf の長さを正しく渡している
    let rc = unsafe {
        getattrlist(
            c_path.as_ptr(),
            (&mut req as *mut AttrList).cast(),
            buf.as_mut_ptr().cast(),
            buf.len(),
            FSOPT_NOFOLLOW | FSOPT_ATTR_CMN_EXTENDED,
        )
    };
    if rc != 0 {
        return None;
    }
    parse_attr_buf(&buf, ATTR_CMNEXT_PRIVATESIZE, ATTR_CMNEXT_CLONEID)
}

#[cfg(not(target_os = "macos"))]
pub fn clone_info(_path: &Path) -> Option<CloneInfo> {
    None
}

/// `getattrlist` の結果を読む。属性は要求したビットの小さい順に、返ったものだけが並ぶ
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_attr_buf(buf: &[u8], private_bit: u32, clone_bit: u32) -> Option<CloneInfo> {
    let u32_at = |off: usize| Some(u32::from_ne_bytes(buf.get(off..off + 4)?.try_into().ok()?));
    let u64_at = |off: usize| Some(u64::from_ne_bytes(buf.get(off..off + 8)?.try_into().ok()?));

    let len = u32_at(0)? as usize;
    // 返った属性の一覧 (attribute_set_t) の 5 つめ (forkattr = commonext)
    let returned_ext = u32_at(4 + 4 * 4)?;
    if returned_ext & private_bit == 0 || returned_ext & clone_bit == 0 {
        return None;
    }
    let private_off = 4 + 4 * 5;
    let clone_off = private_off + 8;
    if len < clone_off + 8 {
        return None;
    }
    Some(CloneInfo { private_bytes: u64_at(private_off)?, clone_id: u64_at(clone_off)? })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buf_with(returned_ext: u32, private: u64, clone: u64) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&40u32.to_ne_bytes());
        b.extend_from_slice(&0x8000_0000u32.to_ne_bytes());
        b.extend_from_slice(&[0u8; 12]);
        b.extend_from_slice(&returned_ext.to_ne_bytes());
        b.extend_from_slice(&private.to_ne_bytes());
        b.extend_from_slice(&clone.to_ne_bytes());
        b
    }

    #[test]
    fn parses_both_attributes() {
        let info = parse_attr_buf(&buf_with(0x108, 4096, 77), 0x8, 0x100).unwrap();
        assert_eq!(info, CloneInfo { private_bytes: 4096, clone_id: 77 });
    }

    #[test]
    fn missing_attribute_means_unknown() {
        assert_eq!(parse_attr_buf(&buf_with(0x100, 4096, 77), 0x8, 0x100), None);
        assert_eq!(parse_attr_buf(&[0u8; 8], 0x8, 0x100), None);
    }

    /// 実際の APFS で、クローンは同じ ID になり、共有分が private に入らないこと
    #[cfg(target_os = "macos")]
    #[test]
    fn clones_share_id_on_apfs() {
        let dir = std::env::temp_dir().join(format!("css-clone-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        let c = dir.join("c.bin");
        let size = 4 * 1024 * 1024;
        std::fs::write(&a, vec![1u8; size]).unwrap();
        std::fs::write(&c, vec![1u8; size]).unwrap();
        // cp -c はクローンを作る (APFS でなければ普通のコピーになる)
        let ok = std::process::Command::new("cp").args(["-c"]).arg(&a).arg(&b).status().unwrap().success();

        let (Some(ia), Some(ib), Some(ic)) = (clone_info(&a), clone_info(&b), clone_info(&c)) else {
            eprintln!("APFS ではないため確認を飛ばします");
            return;
        };
        assert!(ok);
        assert_eq!(ia.clone_id, ib.clone_id, "クローンは同じ ID");
        assert_ne!(ia.clone_id, ic.clone_id, "別に書いたファイルは別の ID");
        assert!(ib.private_bytes < size as u64 / 2, "クローンの中身は共有されている: {ib:?}");
        assert!(ic.private_bytes >= size as u64, "共有していないファイルは全体が private: {ic:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
