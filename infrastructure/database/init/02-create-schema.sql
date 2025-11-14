-- Create meetings table with exclusion constraint to prevent overlapping bookings
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (end_time > start_time),
    -- Exclusion constraint to prevent overlapping meetings for the same resource
    EXCLUDE USING GIST (
        resource_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    )
);

-- Exclude constraint creates GIST index. Fetching mostly by both resource id and time range. Hence explicit index creation is not required for performance improvement.


-- Create recurrence_rules table
CREATE TABLE recurrence_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    frequency VARCHAR(50) NOT NULL,
    interval INTEGER NOT NULL DEFAULT 1,
    by_day INTEGER[] NOT NULL DEFAULT '{}',
    until_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_frequency CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')),
    CONSTRAINT valid_interval CHECK (interval > 0),
  --   CONSTRAINT valid_by_day CHECK (
  --       CASE
  --   WHEN frequency = 'WEEKLY' THEN
  --     (SELECT bool_and(v BETWEEN 0 AND 6) FROM unnest(by_day) AS v)  -- Sunday to Saturday
  --   WHEN frequency = 'MONTHLY' THEN
  --     (SELECT bool_and(v BETWEEN 1 AND 31) FROM unnest(by_day) AS v)
  --   WHEN frequency = 'YEARLY' THEN
  --     (SELECT bool_and(v BETWEEN 1 AND 12) FROM unnest(by_day) AS v)
  --   ELSE
  --     by_day = '{}'  -- empty for DAILY etc.
  -- END
  --   ),
    CONSTRAINT unique_meeting_recurrence UNIQUE (meeting_id)
);

CREATE INDEX idx_recurrence_rules_meeting_id ON recurrence_rules(meeting_id);

-- Create recurrence_exceptions table
CREATE TABLE recurrence_exceptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recurrence_rule_id UUID NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
    exception_type VARCHAR(20) NOT NULL,
    exception_date TIMESTAMPTZ NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_exception_type CHECK (exception_type IN ('SKIP', 'CANCEL'))
);

CREATE INDEX idx_recurrence_exceptions_rule_id ON recurrence_exceptions(recurrence_rule_id);
CREATE INDEX idx_recurrence_exceptions_date ON recurrence_exceptions(exception_date);

-- Create idempotency_keys table for preventing duplicate requests
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    request_hash VARCHAR(64) NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_idempotency_key ON idempotency_keys(idempotency_key);
CREATE INDEX idx_idempotency_expires_at ON idempotency_keys(expires_at); -- TODO : Is this needed?


-- Create function to clean up expired idempotency keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < NOW();
END;
$$ language 'plpgsql';

COMMENT ON TABLE meetings IS 'Stores all meeting bookings with exclusion constraint to prevent overlaps';
COMMENT ON TABLE recurrence_rules IS 'Stores recurrence patterns for recurring meetings';
COMMENT ON TABLE recurrence_exceptions IS 'Stores exceptions (skips/cancellations) for recurring meetings';
COMMENT ON TABLE idempotency_keys IS 'Stores idempotency keys to prevent duplicate booking requests';
