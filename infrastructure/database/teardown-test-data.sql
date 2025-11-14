-- Teardown script to clean up test data after E2E tests
-- This script removes all test data created during test execution

-- Delete all test-related data
-- Order matters due to foreign key constraints

-- Delete recurrence exceptions first
DELETE FROM recurrence_exceptions WHERE recurrence_rule_id IN (
  SELECT id FROM recurrence_rules WHERE meeting_id IN (
    SELECT id FROM meetings WHERE resource_id LIKE 'TEST_%' 
      OR resource_id LIKE 'R%' 
      OR resource_id LIKE 'R_INFINITE_%'
      OR resource_id LIKE 'R_CACHE_%'
  )
);

-- Delete recurrence rules
DELETE FROM recurrence_rules WHERE meeting_id IN (
  SELECT id FROM meetings WHERE resource_id LIKE 'TEST_%' 
    OR resource_id LIKE 'R%' 
    OR resource_id LIKE 'R_INFINITE_%'
    OR resource_id LIKE 'R_CACHE_%'
);

-- Delete idempotency cache entries for test resources
DELETE FROM idempotency_cache WHERE key LIKE '%TEST_%' 
  OR key LIKE '%R123%'
  OR key LIKE '%R456%'
  OR key LIKE '%R789%'
  OR key LIKE '%R999%'
  OR key LIKE '%R111%'
  OR key LIKE '%R222%'
  OR key LIKE '%R333%'
  OR key LIKE '%R444%'
  OR key LIKE '%R555%'
  OR key LIKE '%R666%'
  OR key LIKE '%R_INFINITE_%'
  OR key LIKE '%R_CACHE_%';

-- Delete all test meetings
DELETE FROM meetings WHERE resource_id LIKE 'TEST_%' 
  OR resource_id IN (
    'R123', 'R456', 'R789', 'R999', 'R111', 'R222', 'R333', 
    'R444', 'R555', 'R666', 'R_INFINITE_1', 'R_INFINITE_2', 
    'R_INFINITE_3', 'R_CACHE_1', 'R_CACHE_2', 'R_CACHE_3'
  );

-- Clean up any remaining test data older than 7 days
DELETE FROM recurrence_exceptions WHERE created_at < NOW() - INTERVAL '7 days'
  AND recurrence_rule_id IN (
    SELECT id FROM recurrence_rules WHERE meeting_id IN (
      SELECT id FROM meetings WHERE created_at < NOW() - INTERVAL '7 days'
    )
  );

DELETE FROM recurrence_rules WHERE created_at < NOW() - INTERVAL '7 days'
  AND meeting_id IN (
    SELECT id FROM meetings WHERE created_at < NOW() - INTERVAL '7 days'
  );

DELETE FROM meetings WHERE created_at < NOW() - INTERVAL '7 days'
  AND (resource_id LIKE 'TEST_%' OR resource_id LIKE 'R_%');

-- Verify cleanup
SELECT 'Test data teardown completed.' as status;
SELECT COUNT(*) as remaining_test_meetings FROM meetings WHERE resource_id LIKE 'TEST_%' OR resource_id LIKE 'R_%';
