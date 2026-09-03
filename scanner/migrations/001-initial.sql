CREATE TABLE IF NOT EXISTS source_files (
    source_id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    local_path TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('discovered', 'copied', 'quarantined')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_discoveries (
    discovery_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL REFERENCES source_files(source_id),
    original_relative_path TEXT NOT NULL,
    capture_id TEXT,
    discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_files(source_id),
    page_index INTEGER NOT NULL CHECK (page_index >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (source_id, page_index)
);

CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(document_id),
    bundle_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'queued', 'processing', 'completed', 'failed_retryable',
        'failed_permanent', 'quarantined'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TEXT NOT NULL,
    lease_owner TEXT,
    lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    lease_expires_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (document_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(job_id),
    kind TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    pixel_width INTEGER,
    pixel_height INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (job_id, kind, sha256)
);

CREATE TABLE IF NOT EXISTS results (
    result_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(job_id),
    document_id TEXT NOT NULL REFERENCES documents(document_id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'needs_review')),
    payload_json BLOB NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (job_id, revision),
    UNIQUE (document_id, revision)
);

CREATE TABLE IF NOT EXISTS outbox (
    event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(job_id),
    result_id TEXT NOT NULL REFERENCES results(result_id),
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json BLOB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'retrying', 'blocked', 'delivered')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL,
    last_status_code INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state_events (
    event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT NOT NULL,
    reason TEXT,
    lease_owner TEXT,
    lease_epoch INTEGER,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue
    ON jobs (state, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_leases
    ON jobs (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_outbox_delivery
    ON outbox (state, next_attempt_at, created_at);
