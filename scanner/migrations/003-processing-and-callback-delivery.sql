ALTER TABLE source_files ADD COLUMN media_type TEXT NOT NULL DEFAULT 'application/octet-stream';

ALTER TABLE outbox ADD COLUMN lease_owner TEXT;
ALTER TABLE outbox ADD COLUMN lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0);
ALTER TABLE outbox ADD COLUMN lease_expires_at TEXT;
ALTER TABLE outbox ADD COLUMN replay_count INTEGER NOT NULL DEFAULT 0 CHECK (replay_count >= 0);

CREATE TABLE IF NOT EXISTS callback_attempts (
    attempt_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES outbox(event_id),
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    outcome TEXT CHECK (outcome IN ('delivered', 'retrying', 'blocked')),
    status_code INTEGER,
    error_code TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (event_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_outbox_claim
    ON outbox (state, next_attempt_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_callback_attempts_event
    ON callback_attempts (event_id, attempt_number);
