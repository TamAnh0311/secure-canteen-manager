-- Existing rows intentionally remain NULL. Their jobs fail closed as
-- service_date_missing; restart recovery never guesses a new business date.
ALTER TABLE source_files ADD COLUMN service_date TEXT;

CREATE INDEX IF NOT EXISTS idx_source_files_service_date
    ON source_files (service_date, created_at);
