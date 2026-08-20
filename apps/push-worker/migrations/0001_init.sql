CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled',
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state, fire_at);
CREATE INDEX IF NOT EXISTS jobs_device ON jobs(device_id);
