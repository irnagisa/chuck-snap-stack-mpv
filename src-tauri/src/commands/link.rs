use image::ImageReader;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use tauri::{Manager, State};

use crate::db::DbState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlMetadata {
    pub title: Option<String>,
    pub thumbnail_url: Option<String>,
    pub site_name: Option<String>,
    pub author_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OEmbedResponse {
    title: Option<String>,
    thumbnail_url: Option<String>,
    provider_name: Option<String>,
    author_name: Option<String>,
}

fn build_client() -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 chuck-snap-stack/0.1"),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())
}

/// oEmbed エンドポイントのベース URL とパラメータを返す（対応サービスのみ）
fn oembed_base(url: &str) -> Option<(&'static str, bool)> {
    let lower = url.to_lowercase();
    if lower.contains("youtube.com/") || lower.contains("youtu.be/") {
        Some(("https://www.youtube.com/oembed", true))
    } else if lower.contains("vimeo.com/") {
        Some(("https://vimeo.com/api/oembed.json", false))
    } else if lower.contains("soundcloud.com/") {
        Some(("https://soundcloud.com/oembed", true))
    } else {
        None
    }
}

/// OGP メタタグから情報を取得
fn parse_ogp(html: &str) -> UrlMetadata {
    let document = Html::parse_document(html);

    let og_title_sel = Selector::parse("meta[property='og:title']").ok();
    let og_image_sel = Selector::parse("meta[property='og:image']").ok();
    let og_site_sel = Selector::parse("meta[property='og:site_name']").ok();
    let title_sel = Selector::parse("title").ok();

    let title = og_title_sel
        .as_ref()
        .and_then(|s| document.select(s).next())
        .and_then(|el| el.value().attr("content"))
        .map(str::to_owned)
        .or_else(|| {
            title_sel
                .as_ref()
                .and_then(|s| document.select(s).next())
                .map(|el| el.text().collect::<String>())
        });

    let thumbnail_url = og_image_sel
        .as_ref()
        .and_then(|s| document.select(s).next())
        .and_then(|el| el.value().attr("content"))
        .map(str::to_owned);

    let site_name = og_site_sel
        .as_ref()
        .and_then(|s| document.select(s).next())
        .and_then(|el| el.value().attr("content"))
        .map(str::to_owned);

    UrlMetadata {
        title,
        thumbnail_url,
        site_name,
        author_name: None,
    }
}

/// URL からメタデータを取得する。
/// oEmbed 対応サービスは oEmbed API を優先し、失敗時は OGP にフォールバック。
#[tauri::command]
pub async fn fetch_url_metadata(url: String) -> Result<UrlMetadata, String> {
    super::utils::validate_download_url(&url)?;

    let client = build_client()?;

    // oEmbed 試行
    if let Some((base, needs_format)) = oembed_base(&url) {
        let mut req = client.get(base).query(&[("url", url.as_str())]);
        if needs_format {
            req = req.query(&[("format", "json")]);
        }
        if let Ok(resp) = req.send().await {
            if resp.status().is_success() {
                if let Ok(oembed) = resp.json::<OEmbedResponse>().await {
                    return Ok(UrlMetadata {
                        title: oembed.title,
                        thumbnail_url: oembed.thumbnail_url,
                        site_name: oembed.provider_name,
                        author_name: oembed.author_name,
                    });
                }
            }
        }
    }

    // OGP フォールバック
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Ok(UrlMetadata {
            title: None,
            thumbnail_url: None,
            site_name: None,
            author_name: None,
        });
    }

    let html = resp.text().await.map_err(|e| e.to_string())?;
    Ok(parse_ogp(&html))
}

/// URL をリンクアセットとしてライブラリに追加する。
/// サムネイルURLが指定された場合はダウンロードして保存する。
#[tauri::command]
pub async fn db_add_link_asset(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    url: String,
    title: String,
    thumbnail_url: Option<String>,
) -> Result<i64, String> {
    super::utils::validate_download_url(&url)?;

    // サムネイルダウンロード（失敗しても続行）
    let thumbnail_path: Option<String> = if let Some(thumb_url) = thumbnail_url {
        download_thumbnail(&app, &thumb_url).await.ok()
    } else {
        None
    };

    let db = state.conn()?;
    db.execute(
        "INSERT OR IGNORE INTO videos
          (path, title, media_type, status, source_url, source_type, thumbnail)
         VALUES (?1, ?2, 'link', 'inbox', ?1, 'link', ?3)",
        rusqlite::params![url, title, thumbnail_path],
    )
    .map_err(|e| e.to_string())?;

    // INSERT OR IGNORE: 既存レコードの場合 last_insert_rowid() は 0 になる
    let id = db.last_insert_rowid();
    if id == 0 {
        db.query_row(
            "SELECT id FROM videos WHERE path = ?1",
            rusqlite::params![url],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())
    } else {
        Ok(id)
    }
}

async fn download_thumbnail(app: &tauri::AppHandle, url: &str) -> Result<String, String> {
    super::utils::validate_download_url(url)?;

    let client = build_client()?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    // URL の SHA-256 ハッシュからファイル名を生成
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let filename = format!("link_{}.webp", &hash[..16]);

    let thumbnails_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");

    std::fs::create_dir_all(&thumbnails_dir).map_err(|e| e.to_string())?;

    let output_path = thumbnails_dir.join(&filename);

    // WebP に変換して保存
    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;

    img.save_with_format(&output_path, image::ImageFormat::WebP)
        .map_err(|e| e.to_string())?;

    Ok(output_path.to_string_lossy().into_owned())
}
