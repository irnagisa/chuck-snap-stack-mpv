use std::path::{Component, Path, PathBuf};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv", "media"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

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
