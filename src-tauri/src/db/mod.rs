pub mod migrations;
pub mod schema;

use std::sync::Mutex;

use rusqlite::Connection;

pub struct DbState(pub Mutex<Connection>);
