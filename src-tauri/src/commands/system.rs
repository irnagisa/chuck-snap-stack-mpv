use serde::Serialize;
use sysinfo::Disks;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
}

#[tauri::command]
pub async fn get_disk_info() -> Result<DiskInfo, String> {
    let disks = Disks::new_with_refreshed_list();

    // ホームディレクトリのパスに対応するディスクを優先、なければルート、なければ先頭
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let home_path = std::path::Path::new(&home);

    let disk = disks
        .list()
        .iter()
        .filter(|d| home_path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .or_else(|| disks.list().iter().find(|d| d.mount_point() == std::path::Path::new("/")))
        .or_else(|| disks.list().first())
        .ok_or_else(|| "ディスク情報を取得できませんでした".to_string())?;

    let total = disk.total_space();
    let available = disk.available_space();
    Ok(DiskInfo { total_bytes: total, available_bytes: available, used_bytes: total.saturating_sub(available) })
}
