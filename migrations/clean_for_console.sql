CREATE INDEX IF NOT EXISTS idx_setup_pins_expiry ON setup_pins(expires_at);
CREATE INDEX IF NOT EXISTS idx_setup_pins_used ON setup_pins(used_at);

CREATE TABLE IF NOT EXISTS setup_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS user_password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_history_user ON user_password_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_enrichment_cache (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (entity_type, entity_id, source)
);
CREATE INDEX IF NOT EXISTS idx_media_enrichment_source ON media_enrichment_cache(source, fetched_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  plain TEXT,
  synced TEXT,
  source TEXT NOT NULL DEFAULT 'auto',
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);
