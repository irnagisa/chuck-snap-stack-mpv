use std::path::{Component, Path, PathBuf};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv", "mpg", "mpeg", "media"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "aac", "wav", "ogg", "opus", "m4a", "wma"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "avif"];
const TEXT_EXTENSIONS: &[&str] = &["json", "txt", "csv", "tsv", "md", "xml", "yaml", "yml", "toml", "nfo", "srt", "vtt"];

/// 絶対パスであり `..` コンポーネントや制御文字を含まないことを検証する。
pub fn validate_path(path: &str) -> Result<PathBuf, String> {
    // null バイト・改行文字はパスインジェクションに使われる可能性がある
    if path.contains('\0') || path.contains('\n') || path.contains('\r') {
        return Err(format!("パスに無効な制御文字が含まれています: {path}"));
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(format!("絶対パスを指定してください: {path}"));
    }
    for component in p.components() {
        if component == Component::ParentDir {
            return Err(format!("パストラバーサルは許可されていません: {path}"));
        }
    }
    Ok(p.to_path_buf())
}

/// 動画ファイルのパスを検証する (絶対パス + `..` なし + 動画拡張子)。
pub fn validate_video_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("動画ファイルのみ操作できます: {path}"));
    }
    Ok(p)
}

/// メディアファイルのパスを検証する (絶対パス + `..` なし + 動画/音声/画像拡張子)。
pub fn validate_media_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !VIDEO_EXTENSIONS.contains(&ext.as_str())
        && !AUDIO_EXTENSIONS.contains(&ext.as_str())
        && !IMAGE_EXTENSIONS.contains(&ext.as_str())
    {
        return Err(format!("対応メディアファイルのみ操作できます: {path}"));
    }
    Ok(p)
}

/// テキスト系ファイルのパスを検証する (絶対パス + `..` なし + テキスト拡張子)。
/// 任意ファイルの読み書きを防ぐため、許可する拡張子を明示的に限定する。
pub fn validate_text_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "テキストファイル (.json, .txt, .csv 等) のみ操作できます: {path}"
        ));
    }
    Ok(p)
}

/// 画像出力パスを検証する (絶対パス + `..` なし + 画像拡張子)。
pub fn validate_image_output_path(path: &str) -> Result<PathBuf, String> {
    let p = validate_path(path)?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("画像ファイルパス (.jpg/.png 等) を指定してください: {path}"));
    }
    Ok(p)
}

/// 指定パスに同名ファイルが存在する場合、連番サフィックス (_2, _3, ...) を付与した
/// 一意なパスを返す。存在しない場合は元のパスをそのまま返す。
///
/// # 例
/// - `foo.mp4` が存在しない → `foo.mp4`
/// - `foo.mp4` が存在する → `foo_2.mp4`
/// - `foo.mp4`, `foo_2.mp4` が存在する → `foo_3.mp4`
pub fn resolve_unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let dir = path.parent().unwrap_or(Path::new("."));
    let mut i = 2u32;
    loop {
        let candidate = dir.join(format!("{stem}_{i}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        i += 1;
        if i > 1000 {
            // 1000 件を超えても空きが見つからない場合はタイムスタンプで一意化する
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            return dir.join(format!("{stem}_{ts}{ext}"));
        }
    }
}

/// ダウンロード URL を検証する (スキーム検証 + プライベート IP ブロック + 危険ポートブロック)。
pub fn validate_download_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("URL は https:// または http:// で始まる必要があります".to_string());
    }

    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or("");

    // ユーザー情報 (user:password@host) を拒否
    let authority = without_scheme.split('/').next().unwrap_or("");
    if authority.contains('@') {
        return Err("URL にユーザー情報を含めることはできません".to_string());
    }

    let host_port = authority;
    // IPv6 アドレス [::1] はポートを含む場合 [::1]:8080 の形式
    let (host, port_str) = if host_port.starts_with('[') {
        let host_part = host_port
            .split(']')
            .next()
            .unwrap_or("")
            .trim_start_matches('[');
        let port_part = host_port
            .split(']')
            .nth(1)
            .unwrap_or("")
            .trim_start_matches(':');
        (host_part.to_lowercase(), port_part.to_string())
    } else {
        let mut parts = host_port.splitn(2, ':');
        let h = parts.next().unwrap_or("").to_lowercase();
        let p = parts.next().unwrap_or("").to_string();
        (h, p)
    };

    // ポート番号を検証: 指定されている場合は許可リストに含まれるもののみ許可
    if !port_str.is_empty() {
        let port: u16 = port_str
            .parse()
            .map_err(|_| format!("不正なポート番号: {port_str}"))?;
        const ALLOWED_PORTS: &[u16] = &[80, 443, 8080, 8443];
        if !ALLOWED_PORTS.contains(&port) {
            return Err(format!(
                "ポート {port} は許可されていません。使用可能なポート: 80, 443, 8080, 8443"
            ));
        }
    }

    // ローカルホスト・ループバックをブロック
    const BLOCKED_HOSTS: &[&str] = &["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    if BLOCKED_HOSTS.iter().any(|&h| host == h) {
        return Err("ローカルホストへのアクセスは許可されていません".to_string());
    }

    // mDNS (.local) ホスト名をブロック
    // .local ホスト名は mDNS 経由でプライベート IP に解決される可能性があり SSRF の原因となる
    if host.ends_with(".local") || host == "local" {
        return Err("mDNS (.local) ホストへのアクセスは許可されていません".to_string());
    }

    // プライベート IPv4 範囲をブロック (SSRF 対策)
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        let [a, b, ..] = ip.octets();
        if a == 10
            || a == 127
            || (a == 169 && b == 254)
            || (a == 172 && (16..=31).contains(&b))
            || (a == 192 && b == 168)
        {
            return Err(
                "プライベートネットワークへのアクセスは許可されていません".to_string(),
            );
        }
    }

    // プライベート IPv6 範囲をブロック (SSRF 対策)
    // ::1 (loopback), fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast), :: (unspecified)
    if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
        let seg0 = ip.segments()[0];
        let is_ula = (seg0 & 0xfe00) == 0xfc00;        // fc00::/7
        let is_link_local = (seg0 & 0xffc0) == 0xfe80; // fe80::/10
        let is_multicast = (seg0 & 0xff00) == 0xff00;   // ff00::/8
        if ip.is_loopback() || ip.is_unspecified() || is_ula || is_link_local || is_multicast {
            return Err(
                "プライベートネットワークへのアクセスは許可されていません".to_string(),
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- validate_path ---

    #[test]
    fn validate_path_ok_absolute() {
        assert!(validate_path("/tmp/foo.mp4").is_ok());
    }

    #[test]
    fn validate_path_err_relative() {
        assert!(validate_path("foo/bar.mp4").is_err());
    }

    #[test]
    fn validate_path_err_traversal() {
        assert!(validate_path("/tmp/../etc/passwd").is_err());
    }

    #[test]
    fn validate_path_err_null_byte() {
        assert!(validate_path("/tmp/foo\0bar").is_err());
    }

    #[test]
    fn validate_path_err_newline() {
        assert!(validate_path("/tmp/foo\nbar").is_err());
    }

    // --- validate_video_path ---

    #[test]
    fn validate_video_path_ok_mp4() {
        assert!(validate_video_path("/tmp/video.mp4").is_ok());
    }

    #[test]
    fn validate_video_path_ok_mkv() {
        assert!(validate_video_path("/tmp/video.mkv").is_ok());
    }

    #[test]
    fn validate_video_path_ok_webm() {
        assert!(validate_video_path("/tmp/video.webm").is_ok());
    }

    #[test]
    fn validate_video_path_err_txt() {
        assert!(validate_video_path("/tmp/file.txt").is_err());
    }

    #[test]
    fn validate_video_path_err_jpg() {
        assert!(validate_video_path("/tmp/photo.jpg").is_err());
    }

    #[test]
    fn validate_video_path_err_no_extension() {
        assert!(validate_video_path("/tmp/noext").is_err());
    }

    // --- validate_media_path ---

    #[test]
    fn validate_media_path_ok_video() {
        assert!(validate_media_path("/tmp/video.mp4").is_ok());
    }

    #[test]
    fn validate_media_path_ok_audio() {
        assert!(validate_media_path("/tmp/music.mp3").is_ok());
    }

    #[test]
    fn validate_media_path_ok_image() {
        assert!(validate_media_path("/tmp/photo.jpg").is_ok());
    }

    #[test]
    fn validate_media_path_err_txt() {
        assert!(validate_media_path("/tmp/file.txt").is_err());
    }

    // --- validate_text_path ---

    #[test]
    fn validate_text_path_ok_json() {
        assert!(validate_text_path("/tmp/data.json").is_ok());
    }

    #[test]
    fn validate_text_path_ok_txt() {
        assert!(validate_text_path("/tmp/notes.txt").is_ok());
    }

    #[test]
    fn validate_text_path_ok_csv() {
        assert!(validate_text_path("/tmp/data.csv").is_ok());
    }

    #[test]
    fn validate_text_path_err_mp4() {
        assert!(validate_text_path("/tmp/video.mp4").is_err());
    }

    // --- validate_image_output_path ---

    #[test]
    fn validate_image_output_path_ok_jpg() {
        assert!(validate_image_output_path("/tmp/out.jpg").is_ok());
    }

    #[test]
    fn validate_image_output_path_ok_png() {
        assert!(validate_image_output_path("/tmp/out.png").is_ok());
    }

    #[test]
    fn validate_image_output_path_ok_webp() {
        assert!(validate_image_output_path("/tmp/out.webp").is_ok());
    }

    #[test]
    fn validate_image_output_path_err_mp4() {
        assert!(validate_image_output_path("/tmp/video.mp4").is_err());
    }

    #[test]
    fn validate_image_output_path_err_txt() {
        assert!(validate_image_output_path("/tmp/notes.txt").is_err());
    }

    // --- validate_download_url ---

    #[test]
    fn validate_download_url_ok_https() {
        assert!(validate_download_url("https://example.com/file.mp4").is_ok());
    }

    #[test]
    fn validate_download_url_ok_http() {
        assert!(validate_download_url("http://example.com/file.mp4").is_ok());
    }

    #[test]
    fn validate_download_url_ok_port_443() {
        assert!(validate_download_url("https://example.com:443/file.mp4").is_ok());
    }

    #[test]
    fn validate_download_url_ok_port_8080() {
        assert!(validate_download_url("http://example.com:8080/file.mp4").is_ok());
    }

    #[test]
    fn validate_download_url_err_ftp() {
        assert!(validate_download_url("ftp://example.com/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_localhost() {
        assert!(validate_download_url("http://localhost/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_loopback_ipv4() {
        assert!(validate_download_url("http://127.0.0.1/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_unspecified_ipv4() {
        assert!(validate_download_url("http://0.0.0.0/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_private_10x() {
        assert!(validate_download_url("http://10.1.2.3/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_private_172_16x() {
        assert!(validate_download_url("http://172.16.0.1/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_private_192_168() {
        assert!(validate_download_url("http://192.168.1.1/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_link_local_169_254() {
        assert!(validate_download_url("http://169.254.169.254/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_ipv6_loopback() {
        assert!(validate_download_url("http://[::1]/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_ipv6_ula() {
        assert!(validate_download_url("http://[fc00::1]/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_ipv6_link_local() {
        assert!(validate_download_url("http://[fe80::1]/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_ipv6_multicast() {
        assert!(validate_download_url("http://[ff00::1]/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_user_info() {
        assert!(validate_download_url("http://user:pass@example.com/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_mdns_local() {
        assert!(validate_download_url("http://myhost.local/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_disallowed_port() {
        assert!(validate_download_url("http://example.com:8888/file.mp4").is_err());
    }

    #[test]
    fn validate_download_url_err_invalid_port_str() {
        assert!(validate_download_url("http://example.com:abc/file.mp4").is_err());
    }
}
