pub mod migrations;
pub mod schema;

use std::sync::Mutex;

use rusqlite::Connection;

/// writer: 書き込み専用接続 (WAL writer)
/// reader: 読み取り専用接続 (WAL concurrent reader)
/// SQLite WAL モードでは reader と writer が並行動作可能なため、
/// サムネイル生成などの書き込みバッチ中も UI の読み取りクエリをブロックしない。
pub struct DbState {
    pub writer: Mutex<Connection>,
    pub reader: Mutex<Connection>,
}

impl DbState {
    /// 書き込みコマンド用ロック取得ヘルパー。
    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.writer
            .lock()
            .map_err(|e| format!("データベース書き込み接続ロックの取得に失敗しました: {e}"))
    }

    /// 読み取り専用コマンド用ロック取得ヘルパー。
    /// WAL モードでは writer と並行して読み取り可能。
    pub fn conn_read(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.reader
            .lock()
            .map_err(|e| format!("データベース読み取り接続ロックの取得に失敗しました: {e}"))
    }
}
