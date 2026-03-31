const Database = require('better-sqlite3');
const db = new Database('radio.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname TEXT UNIQUE,
    ip_address TEXT,
    last_ping DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'offline',
    current_song TEXT,
    volume INTEGER DEFAULT 50,
    version TEXT,
    group_id INTEGER,
    playlist_id INTEGER,
    advert_id INTEGER,
    songs_per_ad INTEGER DEFAULT 3
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER, -- client_id or group_id
    target_type TEXT, -- 'client' or 'group'
    start_time TIME,
    end_time TIME,
    playlist_id INTEGER,
    advert_id INTEGER,
    remove_ads_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    path TEXT
  );

  CREATE TABLE IF NOT EXISTS faulty_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname TEXT,
    song_name TEXT,
    reason TEXT DEFAULT 'faulty',
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add reason column if it doesn't exist (for existing databases)
try {
  db.exec("ALTER TABLE faulty_reports ADD COLUMN reason TEXT DEFAULT 'faulty'");
} catch (e) {
  // Column likely already exists
}

try {
  db.exec("ALTER TABLE clients ADD COLUMN version TEXT");
} catch (e) {
  // Column likely already exists
}

module.exports = db;
