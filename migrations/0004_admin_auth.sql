CREATE TABLE admin_oauth_states (
  state_sha256 TEXT PRIMARY KEY NOT NULL,
  browser_sha256 TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX admin_oauth_states_expiry ON admin_oauth_states(expires_at);

CREATE TABLE admin_sessions (
  token_sha256 TEXT PRIMARY KEY NOT NULL,
  github_id TEXT NOT NULL,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
