ALTER TABLE source_discoveries ADD COLUMN ingestion_receipt_id TEXT;
ALTER TABLE source_discoveries ADD COLUMN observed_byte_size INTEGER;
ALTER TABLE source_discoveries ADD COLUMN observed_modified_time_ns INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_discoveries_receipt
    ON source_discoveries (ingestion_receipt_id)
    WHERE ingestion_receipt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_discoveries_observation
    ON source_discoveries (
        original_relative_path,
        observed_byte_size,
        observed_modified_time_ns
    )
    WHERE observed_byte_size IS NOT NULL AND observed_modified_time_ns IS NOT NULL;

CREATE TABLE artifacts_v2 (
    artifact_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(job_id),
    kind TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    pixel_width INTEGER,
    pixel_height INTEGER,
    page_index INTEGER,
    field_name TEXT,
    row_index INTEGER,
    template_version TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (job_id, kind, page_index, field_name)
);

INSERT INTO artifacts_v2(
    artifact_id, job_id, kind, relative_path, media_type, sha256,
    byte_size, pixel_width, pixel_height, created_at
)
SELECT
    artifact_id, job_id, kind, relative_path, media_type, sha256,
    byte_size, pixel_width, pixel_height, created_at
FROM artifacts;

DROP TABLE artifacts;
ALTER TABLE artifacts_v2 RENAME TO artifacts;

CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts (job_id, kind);

CREATE TABLE IF NOT EXISTS ingestion_rejections (
    rejection_id TEXT PRIMARY KEY,
    original_relative_path TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    detail TEXT NOT NULL,
    byte_size INTEGER,
    modified_time_ns INTEGER,
    local_path TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_rejections_created
    ON ingestion_rejections (created_at);

CREATE TABLE IF NOT EXISTS document_fingerprints (
    document_id TEXT PRIMARY KEY REFERENCES documents(document_id),
    fingerprint TEXT NOT NULL,
    possible_duplicate_of TEXT REFERENCES documents(document_id),
    hamming_distance INTEGER,
    created_at TEXT NOT NULL,
    CHECK (length(fingerprint) = 16),
    CHECK (hamming_distance IS NULL OR hamming_distance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_document_fingerprints_created
    ON document_fingerprints (created_at);

CREATE TABLE IF NOT EXISTS document_preprocessing (
    document_id TEXT PRIMARY KEY REFERENCES documents(document_id),
    disposition TEXT NOT NULL CHECK (disposition IN ('aligned', 'needs_review')),
    reason_code TEXT,
    source_markers_json BLOB NOT NULL,
    marker_size_cv REAL,
    reprojection_error_px REAL,
    template_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
        (disposition = 'aligned' AND reason_code IS NULL)
        OR (disposition = 'needs_review' AND reason_code IS NOT NULL)
    )
);
