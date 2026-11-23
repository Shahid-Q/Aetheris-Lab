DROP TABLE admin_oauth_states;
DROP TABLE admin_sessions;

CREATE TABLE admin_sessions (
  token_sha256 TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE admin_login_attempts (
  client_key TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
