-- Setup script to populate database with sample test data
-- This script should be run before executing E2E tests

-- Clear existing test data first
DELETE FROM recurrence_exceptions WHERE recurrence_rule_id IN (
  SELECT id FROM recurrence_rules WHERE meeting_id IN (
    SELECT id FROM meetings WHERE resource_id LIKE 'TEST_%'
  )
);
DELETE FROM recurrence_rules WHERE meeting_id IN (
  SELECT id FROM meetings WHERE resource_id LIKE 'TEST_%'
);
DELETE FROM meetings WHERE resource_id LIKE 'TEST_%';

-- Insert sample non-recurring meetings
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-meeting-1', 'TEST_R001', '2026-01-15 09:00:00+00', '2026-01-15 10:00:00+00', NOW(), NOW()),
  ('test-meeting-2', 'TEST_R001', '2026-01-15 14:00:00+00', '2026-01-15 15:00:00+00', NOW(), NOW()),
  ('test-meeting-3', 'TEST_R002', '2026-01-16 10:00:00+00', '2026-01-16 11:00:00+00', NOW(), NOW()),
  ('test-meeting-4', 'TEST_R003', '2026-01-20 09:00:00+00', '2026-01-20 10:30:00+00', NOW(), NOW()),
  ('test-meeting-5', 'TEST_R003', '2026-01-20 11:00:00+00', '2026-01-20 12:00:00+00', NOW(), NOW());

-- Insert sample recurring meetings (Weekly)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-recurring-1', 'TEST_R004', '2026-01-06 09:00:00+00', '2026-01-06 10:00:00+00', NOW(), NOW()),
  ('test-recurring-2', 'TEST_R005', '2026-01-13 14:00:00+00', '2026-01-13 15:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until, created_at, updated_at) VALUES
  ('test-rrule-1', 'test-recurring-1', 'WEEKLY', 1, ARRAY[1], '2026-03-31 23:59:59+00', NOW(), NOW()),
  ('test-rrule-2', 'test-recurring-2', 'WEEKLY', 1, ARRAY[2, 4], '2026-06-30 23:59:59+00', NOW(), NOW());

-- Insert sample recurring meetings (Daily)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-recurring-3', 'TEST_R006', '2026-01-01 08:00:00+00', '2026-01-01 09:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until, created_at, updated_at) VALUES
  ('test-rrule-3', 'test-recurring-3', 'DAILY', 1, ARRAY[]::integer[], '2026-01-31 23:59:59+00', NOW(), NOW());

-- Insert sample recurring meetings (Monthly)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-recurring-4', 'TEST_R007', '2026-01-15 10:00:00+00', '2026-01-15 11:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until, created_at, updated_at) VALUES
  ('test-rrule-4', 'test-recurring-4', 'MONTHLY', 1, ARRAY[]::integer[], '2026-12-31 23:59:59+00', NOW(), NOW());

-- Insert sample recurring meetings (Yearly)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-recurring-5', 'TEST_R008', '2026-03-01 12:00:00+00', '2026-03-01 13:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until, created_at, updated_at) VALUES
  ('test-rrule-5', 'test-recurring-5', 'YEARLY', 1, ARRAY[]::integer[], '2030-12-31 23:59:59+00', NOW(), NOW());

-- Insert sample infinite recurring meetings
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-infinite-1', 'TEST_R009', '2026-01-05 09:00:00+00', '2026-01-05 10:00:00+00', NOW(), NOW()),
  ('test-infinite-2', 'TEST_R010', '2026-01-01 14:00:00+00', '2026-01-01 15:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until, created_at, updated_at) VALUES
  ('test-rrule-6', 'test-infinite-1', 'WEEKLY', 1, ARRAY[1], NULL, NOW(), NOW()),
  ('test-rrule-7', 'test-infinite-2', 'DAILY', 1, ARRAY[]::integer[], NULL, NOW(), NOW());

-- Insert meetings with exceptions
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('test-exception-1', 'TEST_R011', '2026-01-06 10:00:00+00', '2026-01-06 11:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until, created_at, updated_at) VALUES
  ('test-rrule-8', 'test-exception-1', 'WEEKLY', 1, ARRAY[1], '2026-03-31 23:59:59+00', NOW(), NOW());

INSERT INTO recurrence_exceptions (id, recurrence_rule_id, exception_type, exception_date, reason, created_at) VALUES
  ('test-exception-1-1', 'test-rrule-8', 'SKIP', '2026-01-20 10:00:00+00', 'Holiday', NOW()),
  ('test-exception-1-2', 'test-rrule-8', 'CANCEL', '2026-02-03 10:00:00+00', 'Cancelled', NOW());

-- Verify data insertion
SELECT 'Test data setup completed.' as status;
SELECT COUNT(*) as meetings_count FROM meetings WHERE resource_id LIKE 'TEST_%';
SELECT COUNT(*) as recurrence_rules_count FROM recurrence_rules WHERE meeting_id IN (
  SELECT id FROM meetings WHERE resource_id LIKE 'TEST_%'
);
SELECT COUNT(*) as exceptions_count FROM recurrence_exceptions WHERE recurrence_rule_id IN (
  SELECT id FROM recurrence_rules WHERE meeting_id IN (
    SELECT id FROM meetings WHERE resource_id LIKE 'TEST_%'
  )
);
