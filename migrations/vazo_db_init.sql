CREATE DATABASE vazo_db;
USE DATABASE vazo_db;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_enc TEXT NOT NULL,
  api_key TEXT UNIQUE,
  email TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  sort_name TEXT,
  cover_key TEXT,
  album_count INTEGER NOT NULL DEFAULT 0,
  song_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  name TEXT NOT NULL COLLATE NOCASE,
  year INTEGER,
  genre TEXT,
  cover_key TEXT,
  song_count INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER
);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_created ON albums(created_at DESC);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id),
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  title TEXT NOT NULL,
  track_no INTEGER,
  disc_no INTEGER DEFAULT 1,
  year INTEGER,
  genre TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  bitrate INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  suffix TEXT NOT NULL,
  content_type TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  comment TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS stars (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS play_queue (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_track_id INTEGER,
  position_sec REAL NOT NULL DEFAULT 0,
  changed_at INTEGER NOT NULL,
  tracks_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scrobbles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  submission INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_scrobbles_user ON scrobbles(user_id, played_at DESC);

CREATE TABLE IF NOT EXISTS setup_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_setup_pins_expiry ON setup_pins(expires_at);
CREATE INDEX IF NOT EXISTS idx_setup_pins_used ON setup_pins(used_at);

CREATE TABLE IF NOT EXISTS lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  plain TEXT,
  synced TEXT,
  source TEXT NOT NULL DEFAULT 'auto',
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);
