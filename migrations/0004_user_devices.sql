-- User devices table for multi-device support and account transfer
CREATE TABLE user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_user_devices_device_id ON user_devices(device_id);
CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);

-- Migrate existing device_id from users to user_devices
INSERT INTO user_devices (id, user_id, device_id, created_at)
SELECT id || '_dev', id, device_id, created_at FROM users WHERE device_id IS NOT NULL;
