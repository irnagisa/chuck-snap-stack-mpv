pub mod migrations;
pub mod schema;

use std::sync::Mutex;

use rusqlite::Connection;

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    /// DB 接続ロックを取得する共通ヘルパー。
    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.0.lock().map_err(|e| e.to_string())
    }
}
