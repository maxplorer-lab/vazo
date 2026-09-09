CREATE TABLE IF NOT EXISTS setup_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_pins_expiry ON setup_pins(expires_at);
CREATE INDEX IF NOT EXISTS idx_pins_used ON setup_pins(used_at);
