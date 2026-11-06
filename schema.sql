CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_events (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  email_tried     VARCHAR(255),
  success         BOOLEAN NOT NULL,
  failure_reason  VARCHAR(30),
  ip_address      INET,
  user_agent      TEXT,
  country         VARCHAR(2),
  city            VARCHAR(100),
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  browser         VARCHAR(50),
  os              VARCHAR(50),
  device          VARCHAR(20),
  screen_res      VARCHAR(20),
  language        VARCHAR(20),
  timezone        VARCHAR(60),
  connection_type VARCHAR(20),
  cpu_cores       SMALLINT,
  gps_lat         DOUBLE PRECISION,
  gps_lng         DOUBLE PRECISION,
  gps_accuracy    DOUBLE PRECISION,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_ip   ON login_events (ip_address);

CREATE TABLE IF NOT EXISTS sessions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id),
  token_hash TEXT NOT NULL,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
