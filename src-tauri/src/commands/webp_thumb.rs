//! サムネイルを WebP で書き出す。
//!
//! ffmpeg は WebP を読めても、書き出しには libwebp を組み込んだビルドが要る。
//! Homebrew の `ffmpeg` など libwebp なしで配布されているビルドもあるため、
//! 書けないときは ffmpeg に PNG を書かせ、アプリ側 (`webp` クレート) で WebP にする。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// 非可逆 WebP の画質 (ffmpeg の `-q:v` と同じ 0〜100)
const WEBP_QUALITY: f32 = 80.0;

/// `ffmpeg -encoders` の一覧に、その名前のエンコーダーがあるか (各行は ` V....D 名前  説明` の形)
pub(crate) fn encoder_listed(list: &str, name: &str) -> bool {
    list.lines().any(|l| l.split_whitespace().nth(1) == Some(name))
}

/// `ffmpeg -encoders` の出力。ffmpeg を起動できなければ None
pub(crate) async fn list_encoders(ffmpeg_path: &str) -> Option<String> {
    match tokio::process::Command::new(ffmpeg_path).args(["-hide_banner", "-encoders"]).output().await {
        Ok(out) => Some(String::from_utf8_lossy(&out.stdout).into_owned()),
        Err(e) => {
            log::warn!("[ffmpeg] エンコーダー一覧の取得に失敗しました: {e}");
            None
        }
    }
}

/// この ffmpeg が WebP を書けるか。サムネイルは 1 枚ずつ大量に作るので ffmpeg のパスごとに覚えておく
async fn supports_webp(ffmpeg_path: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(&known) = cache.lock().ok().and_then(|c| c.get(ffmpeg_path).copied()).as_ref() {
        return known;
    }
    // 一覧が取れないときは覚えずに「書ける」とみなす (本番の呼び出しが ffmpeg のエラーを返す)
    let Some(list) = list_encoders(ffmpeg_path).await else { return true };
    let ok = encoder_listed(&list, "libwebp");
    if !ok {
        log::warn!("[thumbnail] {ffmpeg_path} は WebP を書けないため、PNG 経由でアプリ側で WebP にします");
    }
    if let Ok(mut c) = cache.lock() {
        c.insert(ffmpeg_path.to_string(), ok);
    }
    ok
}

/// ffmpeg を実行し、失敗したら標準エラーの末尾をエラーにする
async fn run_ffmpeg(ffmpeg_path: &str, args: &[&str]) -> Result<(), String> {
    let out = tokio::process::Command::new(ffmpeg_path)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| format!("ffmpeg を起動できません ({ffmpeg_path}): {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("ffmpeg が失敗しました: {}", stderr_tail(&out.stderr)))
    }
}

/// エラー表示用に、標準エラーの最後の数行を 1 行にまとめる
fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(3)..].join(" / ");
    if tail.is_empty() { "(エラー出力なし)".to_string() } else { tail }
}

async fn non_empty(path: &str) -> bool {
    tokio::fs::metadata(path).await.is_ok_and(|m| m.len() > 0)
}

/// RGBA 画像を非可逆 WebP にして書き込む
pub(crate) fn write_webp(img: &image::DynamicImage, output_path: &str) -> Result<(), String> {
    let rgba = img.to_rgba8();
    let encoded = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height()).encode(WEBP_QUALITY);
    std::fs::write(output_path, &*encoded).map_err(|e| format!("サムネイルを書き込めません: {e}"))
}

/// ffmpeg で 1 枚の画像を取り出し、WebP のサムネイルとして `output_path` に書く。
/// `args` は入力とフィルターの指定 (`-y`・画質・出力先は含めない)。
pub(crate) async fn ffmpeg_to_webp(ffmpeg_path: &str, args: &[&str], output_path: &str) -> Result<(), String> {
    if supports_webp(ffmpeg_path).await {
        ffmpeg_webp_direct(ffmpeg_path, args, output_path).await
    } else {
        ffmpeg_webp_via_png(ffmpeg_path, args, output_path).await
    }
}

/// ffmpeg (libwebp) に WebP を直接書かせる
async fn ffmpeg_webp_direct(ffmpeg_path: &str, args: &[&str], output_path: &str) -> Result<(), String> {
    let mut full = args.to_vec();
    full.extend(["-q:v", "80", output_path]);
    run_ffmpeg(ffmpeg_path, &full).await?;
    if non_empty(output_path).await {
        Ok(())
    } else {
        Err("ffmpeg は終了しましたが画像が書き出されませんでした".to_string())
    }
}

/// ffmpeg には PNG を書かせ、アプリ側で WebP にする (libwebp なしの ffmpeg 用)
async fn ffmpeg_webp_via_png(ffmpeg_path: &str, args: &[&str], output_path: &str) -> Result<(), String> {
    let tmp_png = format!("{output_path}.frame.png");
    let mut full = args.to_vec();
    full.extend(["-c:v", "png", "-f", "image2", &tmp_png]);
    let result = async {
        run_ffmpeg(ffmpeg_path, &full).await?;
        if !non_empty(&tmp_png).await {
            return Err("ffmpeg は終了しましたが画像が書き出されませんでした".to_string());
        }
        let (png, out) = (tmp_png.clone(), output_path.to_string());
        tokio::task::spawn_blocking(move || {
            let img = image::open(&png).map_err(|e| format!("取り出した画像を読めません: {e}"))?;
            write_webp(&img, &out)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    .await;
    let _ = tokio::fs::remove_file(&tmp_png).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn encoder_listed_matches_whole_names_only() {
        let list = " V..... = Video\n ------\n V....D libwebp_anim         libwebp WebP image (codec webp)\n V....D libwebp              libwebp WebP image (codec webp)\n";
        assert!(encoder_listed(list, "libwebp"));
        assert!(encoder_listed(list, "libwebp_anim"));
        assert!(!encoder_listed(" V....D libwebp_anim  libwebp WebP image\n", "libwebp"));
        assert!(!encoder_listed(" V....D libx264  libx264 H.264 (codec h264)\n", "libwebp"), "説明文の一致は数えない");
    }

    #[test]
    fn stderr_tail_keeps_last_lines() {
        let err = b"line1\n\nline2\nline3\nline4\n";
        assert_eq!(stderr_tail(err), "line2 / line3 / line4");
        assert_eq!(stderr_tail(b""), "(エラー出力なし)");
    }

    #[test]
    fn write_webp_produces_lossy_webp() {
        let dir = std::env::temp_dir().join(format!("css-webp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("t.webp");
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(320, 180, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        }));
        write_webp(&img, out.to_str().unwrap()).unwrap();
        let bytes = std::fs::read(&out).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
        assert_eq!(&bytes[12..16], b"VP8 ", "非可逆 (VP8) で書かれる");
        let back = image::open(&out).unwrap();
        assert_eq!((back.width(), back.height()), (320, 180));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 実際の ffmpeg で、WebP を書ける場合と書けない場合 (PNG 経由) の両方を確かめる
    #[tokio::test]
    #[ignore = "ffmpeg が必要"]
    async fn real_ffmpeg_writes_webp_both_ways() {
        let dir = std::env::temp_dir().join(format!("css-webp-it-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let args = ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-frames:v", "1", "-vf", "scale=320:-2"];

        let direct = dir.join("direct.webp").to_string_lossy().into_owned();
        ffmpeg_to_webp("ffmpeg", &args, &direct).await.unwrap();
        assert_eq!(image::open(&direct).unwrap().width(), 320);

        // WebP を書けない ffmpeg 向けの経路 (PNG 経由)。一時 PNG は残さない
        let fallback = dir.join("fallback.webp").to_string_lossy().into_owned();
        ffmpeg_webp_via_png("ffmpeg", &args, &fallback).await.unwrap();
        assert_eq!(&std::fs::read(&fallback).unwrap()[12..16], b"VP8 ", "非可逆 WebP");
        assert_eq!(image::open(&fallback).unwrap().width(), 320);
        assert!(!Path::new(&format!("{fallback}.frame.png")).exists());

        // 失敗時は ffmpeg のエラーが返る
        let err = ffmpeg_to_webp("ffmpeg", &["-i", "/nonexistent/x.mp4"], &dir.join("x.webp").to_string_lossy())
            .await
            .unwrap_err();
        assert!(err.contains("No such file"), "{err}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
