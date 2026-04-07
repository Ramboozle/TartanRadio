/**
 * Tartan Radio - Database Management
 * 
 * This module initializes and exports the SQLite database connection using 'better-sqlite3'.
 * It defines the core schema for the entire system, including clients, groups, schedules, 
 * and reporting.
 */

const Database = require('better-sqlite3');

/**
 * Initialize the database file 'radio.db'.
 * This file will be created in the server's root directory if it doesn't exist.
 */
const db = new Database('radio.db');

/**
 * SCHEMA INITIALIZATION
 * Executed on every server start to ensure the structural integrity of the database.
 */
db.exec(`
  /**
   * CLIENTS TABLE
   * Stores the state and configuration of every Raspberry Pi/Windows client.
   * - hostname: Unique identifier for the client (usually the OS hostname).
   * - ip_address: The last known IP of the client.
   * - last_ping: Timestamp of the most recent heartbeat.
   * - status: Current playback state ('playing', 'stopped', 'syncing').
   * - current_song: The filename of the song currently playing.
   * - songs_per_ad: Rotation setting (how many music tracks play before an advert).
   */
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

  /**
   * GROUPS TABLE
   * Allows clients to be categorized (e.g., 'Showroom', 'Workshop') for bulk commands.
   */
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    description TEXT
  );

  /**
   * SCHEDULES TABLE (Draft Feature)
   * Future-proofing for automated playback based on time of day.
   */
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

  /**
   * PLAYLISTS TABLE
   * Metadata for organized collections of music.
   */
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    path TEXT
  );

  /**
   * FAULTY_REPORTS TABLE
   * Stores logs of problematic songs flagged by users or clients.
   * Helps administrators identify and delete corrupted or inappropriate files.
   */
  CREATE TABLE IF NOT EXISTS faulty_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname TEXT,
    song_name TEXT,
    reason TEXT DEFAULT 'faulty',
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * MIGRATIONS / SCHEMA UPDATES
 * These blocks handle incremental updates to the database for existing installations.
 * Using try-catch ensures the server doesn't crash if a column already exists.
 */

// Add 'reason' column to reports if it's missing (legacy support)
try {
  db.exec("ALTER TABLE faulty_reports ADD COLUMN reason TEXT DEFAULT 'faulty'");
} catch (e) {
  // Column already exists, no action needed
}

// Add 'version' column to clients if it's missing (introduced in v2.1)
try {
  db.exec("ALTER TABLE clients ADD COLUMN version TEXT");
} catch (e) {
  // Column already exists, no action needed
}

/**
 * Export the database instance for use in other server modules.
 */
module.exports = db;

