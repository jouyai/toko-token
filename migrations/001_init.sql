-- Uang disimpan dalam milli-rupiah (1 Rupiah = 1000) supaya potongan per token
-- yang nilainya pecahan Rupiah tetap akurat tanpa floating point.

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  balance_milli BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- sha256 dari token cookie
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE api_keys (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,            -- ditampilkan di dashboard, mis. "tt_live_a1b2"
  key_hash     TEXT NOT NULL UNIQUE,     -- sha256 dari key lengkap
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_user_idx ON api_keys (user_id);

CREATE TABLE models (
  id              TEXT PRIMARY KEY,      -- nama model yang dilihat pembeli, mis. "glm-5.1"
  upstream_model  TEXT NOT NULL,         -- nama model di 9router, mis. "glm/glm-5.1" atau nama combo
  display_name    TEXT NOT NULL,
  vendor          TEXT NOT NULL DEFAULT '',
  context_label   TEXT NOT NULL DEFAULT '',
  input_price_rp  INTEGER NOT NULL CHECK (input_price_rp >= 0),   -- per 1 juta token
  output_price_rp INTEGER NOT NULL CHECK (output_price_rp >= 0),  -- per 1 juta token
  tag             TEXT NOT NULL DEFAULT '',
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  order_id     TEXT PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  provider     TEXT NOT NULL,
  amount_rp    INTEGER NOT NULL CHECK (amount_rp > 0),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  redirect_url TEXT,
  method       TEXT,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

-- Semua mutasi saldo selain pemakaian API (top-up, koreksi admin, refund).
CREATE TABLE ledger (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id),
  kind                TEXT NOT NULL CHECK (kind IN ('topup', 'adjustment', 'refund')),
  amount_milli        BIGINT NOT NULL,
  balance_after_milli BIGINT NOT NULL,
  ref                 TEXT,
  note                TEXT NOT NULL DEFAULT '',
  actor_id            BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger (user_id, created_at DESC);
CREATE UNIQUE INDEX ledger_topup_ref_key ON ledger (ref) WHERE kind = 'topup';

-- Satu baris per request API yang ditagih.
CREATE TABLE usage_logs (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id),
  api_key_id        BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  model_id          TEXT NOT NULL,
  upstream_model    TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_milli        BIGINT NOT NULL DEFAULT 0,
  estimated         BOOLEAN NOT NULL DEFAULT false,
  stream            BOOLEAN NOT NULL DEFAULT false,
  status            INTEGER NOT NULL,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_logs_user_idx ON usage_logs (user_id, created_at DESC);
CREATE INDEX usage_logs_created_idx ON usage_logs (created_at);
