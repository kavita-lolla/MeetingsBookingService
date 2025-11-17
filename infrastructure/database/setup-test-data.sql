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
  ('11111111-1111-4111-8111-111111111111', 'TEST_R001', '2026-01-15 09:00:00+00', '2026-01-15 10:00:00+00', NOW(), NOW()),
  ('22222222-2222-4222-8222-222222222222', 'TEST_R001', '2026-01-15 14:00:00+00', '2026-01-15 15:00:00+00', NOW(), NOW()),
  ('33333333-3333-4333-8333-333333333333', 'TEST_R002', '2026-01-16 10:00:00+00', '2026-01-16 11:00:00+00', NOW(), NOW()),
  ('44444444-4444-4444-8444-444444444444', 'TEST_R003', '2026-01-20 09:00:00+00', '2026-01-20 10:30:00+00', NOW(), NOW()),
  ('55555555-5555-4555-8555-555555555555', 'TEST_R003', '2026-01-20 11:00:00+00', '2026-01-20 12:00:00+00', NOW(), NOW());

-- Insert sample recurring meetings (Weekly)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('66666666-6666-4666-8666-666666666666', 'TEST_R004', '2026-01-06 09:00:00+00', '2026-01-06 10:00:00+00', NOW(), NOW()),
  ('77777777-7777-4777-8777-777777777777', 'TEST_R005', '2026-01-13 14:00:00+00', '2026-01-13 15:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until_date, created_at, updated_at) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '66666666-6666-4666-8666-666666666666', 'WEEKLY', 1, ARRAY[1], '2026-03-31 23:59:59+00', NOW(), NOW()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '77777777-7777-4777-8777-777777777777', 'WEEKLY', 1, ARRAY[2,4], '2026-06-30 23:59:59+00', NOW(), NOW());

-- Insert sample recurring meetings (Daily)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('88888888-8888-4888-8888-888888888888', 'TEST_R006', '2026-01-01 08:00:00+00', '2026-01-01 09:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until_date, created_at, updated_at) VALUES
  ('abababab-abab-4bab-8bab-abababababab', '88888888-8888-4888-8888-888888888888', 'DAILY', 1, ARRAY[]::integer[], '2026-01-31 23:59:59+00', NOW(), NOW());

-- Insert sample recurring meetings (Monthly)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('99999999-9999-4999-8999-999999999999', 'TEST_R007', '2026-01-15 10:00:00+00', '2026-01-15 11:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until_date, created_at, updated_at) VALUES
  ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', '99999999-9999-4999-8999-999999999999', 'MONTHLY', 1, ARRAY[]::integer[], '2026-12-31 23:59:59+00', NOW(), NOW());

-- Insert sample recurring meetings (Yearly)
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TEST_R008', '2026-03-01 12:00:00+00', '2026-03-01 13:00:00+00', NOW(), NOW());

-- Insert sample infinite recurring meetings
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TEST_R009', '2026-01-05 09:00:00+00', '2026-01-05 10:00:00+00', NOW(), NOW()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'TEST_R010', '2026-01-01 14:00:00+00', '2026-01-01 15:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until_date, created_at, updated_at) VALUES
  ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'WEEKLY', 1, ARRAY[1], NULL, NOW(), NOW()),
  ('dededede-dede-4ede-8ede-dededededede', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'DAILY', 1, ARRAY[]::integer[], NULL, NOW(), NOW());

-- Insert meetings with exceptions
INSERT INTO meetings (id, resource_id, start_time, end_time, created_at, updated_at) VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'TEST_R011', '2026-01-06 10:00:00+00', '2026-01-06 11:00:00+00', NOW(), NOW());

INSERT INTO recurrence_rules (id, meeting_id, frequency, interval, by_day, until_date, created_at, updated_at) VALUES
  ('efefefef-efef-4fef-8fef-efefefefefef', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'WEEKLY', 1, ARRAY[1], '2026-03-31 23:59:59+00', NOW(), NOW());

INSERT INTO recurrence_exceptions (id, recurrence_rule_id, exception_type, exception_date, reason, created_at) VALUES
  ('abababab-abab-4cec-8cec-ababcecabab0', 'efefefef-efef-4fef-8fef-efefefefefef', 'SKIP', '2026-01-20 10:00:00+00', 'Holiday', NOW()),
  ('cdcdcdcd-cdcd-4cec-8cec-cdcdcecacd00', 'efefefef-efef-4fef-8fef-efefefefefef', 'CANCEL', '2026-02-03 10:00:00+00', 'Cancelled', NOW());

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
