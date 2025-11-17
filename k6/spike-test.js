import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const errorRate = new Rate('error_rate');
const bookingDuration = new Trend('booking_duration');
const availabilityDuration = new Trend('availability_duration');
const successfulBookings = new Counter('successful_bookings');
const failedBookings = new Counter('failed_bookings');
const conflictErrors = new Counter('conflict_errors');
const systemErrors = new Counter('system_errors');

// Test configuration for spike test: 10,000 requests in 30 seconds
export const options = {
  stages: [
    { duration: '10s', target: 50 },    // Ramp up to 50 VUs
    { duration: '30s', target: 500 },   // Spike to 500 VUs (simulating 10,000 requests burst)
    { duration: '10s', target: 50 },    // Ramp down to 50 VUs
    { duration: '20s', target: 0 },     // Recovery period
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'], // More lenient thresholds during spike
    error_rate: ['rate<0.15'], // Allow up to 15% error rate during spike
    http_req_failed: ['rate<0.2'], // Allow up to 20% failed requests during spike
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

// Generate sample resource IDs (fewer resources for more contention)
const RESOURCES = Array.from({ length: 20 }, (_, i) => `SPIKE_R${String(i + 1).padStart(3, '0')}`);

// Helper function to generate random date within next 7 days (shorter window for more conflicts)
function getRandomFutureDate() {
  const now = new Date();
  const daysAhead = Math.floor(Math.random() * 7) + 1;
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  
  // Random hour between 9 AM and 5 PM
  const hour = Math.floor(Math.random() * 8) + 9;
  futureDate.setHours(hour, 0, 0, 0);
  
  return futureDate;
}

// Helper function to generate idempotency key
function generateIdempotencyKey() {
  return `spike-test-${Date.now()}-${randomString(16)}`;
}

export default function () {
  const scenarioStart = Date.now();
  
  // Use fewer resources to increase contention
  const resourceId = RESOURCES[Math.floor(Math.random() * RESOURCES.length)];
  const startTime = getRandomFutureDate();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration
  
  const idempotencyKey = generateIdempotencyKey();
  
  // Lower chance of recurring meetings during spike test
  const isRecurring = Math.random() < 0.1;
  
  const payload = {
    resource_id: resourceId,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
  };
  
  if (isRecurring) {
    payload.recurrence_rule = {
      frequency: 'WEEKLY',
      interval: 1,
      day: [],
      until: new Date(startTime.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    };
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  
  // Test 1: Create booking
  const createStart = Date.now();
  const createResponse = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify(payload),
    { headers, timeout: '10s' }
  );
  const createDuration = Date.now() - createStart;
  
  bookingDuration.add(createDuration);
  
  const createSuccess = check(createResponse, {
    'request completed': (r) => r.status !== 0,
    'valid response status': (r) => [200, 400, 409, 500, 503].includes(r.status),
  });

  if (createResponse.status === 200 || createResponse.status === 201) {
    successfulBookings.add(1);
  } else if (createResponse.status === 409) {
    conflictErrors.add(1);
    failedBookings.add(1);
  } else if ([400, 422].includes(createResponse.status)) {
    failedBookings.add(1);
  } else {
    systemErrors.add(1);
    failedBookings.add(1);
    errorRate.add(1);
  }
  
  // Minimal sleep during spike
  sleep(0.01);
  
  // Test 2: Query availability (30% of requests to add load)
  if (Math.random() < 0.3) {
    const queryStart = getRandomFutureDate();
    const queryEnd = new Date(queryStart.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
    
    const availStart = Date.now();
    const availResponse = http.get(
      `${BASE_URL}/api/availability/${resourceId}?start_time=${queryStart.toISOString()}&end_time=${queryEnd.toISOString()}`,
      { headers: { 'Content-Type': 'application/json' }, timeout: '10s' }
    );
    const availDuration = Date.now() - availStart;
    
    availabilityDuration.add(availDuration);
    
    check(availResponse, {
      'availability query completed': (r) => r.status !== 0,
      'availability valid status': (r) => [200, 400, 500, 503].includes(r.status),
    });
    
    if (![200, 400].includes(availResponse.status)) {
      errorRate.add(1);
    }
  }
  
  // Very minimal sleep to maintain spike pressure
  sleep(0.05);
}

// Setup function - runs once at the beginning
export function setup() {
  console.log('Starting spike test: 10,000 requests in 30 seconds');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('Test stages:');
  console.log('  - 10s: Ramp up to 50 VUs');
  console.log('  - 30s: SPIKE to 500 VUs');
  console.log('  - 10s: Ramp down to 50 VUs');
  console.log('  - 20s: Recovery');
  
  // Health check
  const healthResponse = http.get(`${BASE_URL}/api/health`);
  if (healthResponse.status !== 200) {
    console.warn('Warning: API health check failed - service may not be running properly');
  }
  
  return { 
    startTime: new Date().toISOString(),
    testType: 'spike',
  };
}

// Teardown function - runs once at the end
export function teardown(data) {
  console.log('\nSpike test completed');
  console.log(`Started at: ${data.startTime}`);
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log('\nAnalyzing system behavior during spike...');
}

// Handle summary to export detailed results
export function handleSummary(data) {
  const summary = generateDetailedSummary(data);
  
  return {
    'spike-test-results.json': JSON.stringify(data, null, 2),
    'spike-test-summary.txt': summary,
    stdout: summary,
  };
}

function generateDetailedSummary(data) {
  let summary = '\n╔════════════════════════════════════════════════════════════╗\n';
  summary += '║              SPIKE TEST RESULTS SUMMARY                    ║\n';
  summary += '╚════════════════════════════════════════════════════════════╝\n\n';
  
  // Test duration
  const duration = data.state.testRunDurationMs / 1000;
  summary += `Test Duration: ${duration.toFixed(2)}s\n`;
  summary += `Test Type: Spike Test (10,000 requests burst in 30s)\n\n`;
  
  // Request metrics
  summary += '┌─────────────────────────────────────────────────────────────┐\n';
  summary += '│ REQUEST METRICS                                             │\n';
  summary += '└─────────────────────────────────────────────────────────────┘\n';
  
  if (data.metrics.http_reqs) {
    const totalReqs = data.metrics.http_reqs.values.count;
    const reqRate = data.metrics.http_reqs.values.rate;
    summary += `  Total Requests:        ${totalReqs}\n`;
    summary += `  Request Rate:          ${reqRate.toFixed(2)} req/s\n`;
    summary += `  Peak Load Achieved:    ${(reqRate * 30).toFixed(0)} requests (estimated)\n\n`;
  }
  
  // Response time metrics
  summary += '┌─────────────────────────────────────────────────────────────┐\n';
  summary += '│ RESPONSE TIME ANALYSIS                                      │\n';
  summary += '└─────────────────────────────────────────────────────────────┘\n';
  
  if (data.metrics.http_req_duration) {
    const metrics = data.metrics.http_req_duration.values;
    summary += `  Average:               ${metrics.avg.toFixed(2)}ms\n`;
    summary += `  Minimum:               ${metrics.min.toFixed(2)}ms\n`;
    summary += `  Maximum:               ${metrics.max.toFixed(2)}ms\n`;
    summary += `  Median (P50):          ${metrics.med.toFixed(2)}ms\n`;
    summary += `  P90:                   ${metrics['p(90)'].toFixed(2)}ms\n`;
    summary += `  P95:                   ${metrics['p(95)'].toFixed(2)}ms\n`;
    summary += `  P99:                   ${metrics['p(99)'].toFixed(2)}ms\n\n`;
    
    // Performance assessment
    summary += '  Performance Assessment:\n';
    if (metrics['p(95)'] < 2000) {
      summary += '  ✓ EXCELLENT - 95% of requests under 2s during spike\n';
    } else if (metrics['p(95)'] < 5000) {
      summary += '  ✓ GOOD - 95% of requests under 5s during spike\n';
    } else {
      summary += '  ✗ DEGRADED - 95% of requests exceed 5s during spike\n';
    }
    summary += '\n';
  }
  
  // Error analysis
  summary += '┌─────────────────────────────────────────────────────────────┐\n';
  summary += '│ ERROR ANALYSIS                                              │\n';
  summary += '└─────────────────────────────────────────────────────────────┘\n';
  
  // const successCount = data.metrics.successful_bookings?.values.count || 0;
  // const failCount = data.metrics.failed_bookings?.values.count || 0;
  // const conflictCount = data.metrics.conflict_errors?.values.count || 0;
  // const systemErrorCount = data.metrics.system_errors?.values.count || 0;
  const successCount = data.metrics.successful_bookings || 0;
  const failCount = data.metrics.failed_bookings || 0;
  const conflictCount = data.metrics.conflict_errors || 0;
  const systemErrorCount = data.metrics.system_errors || 0;
  const totalBookings = successCount + failCount;
  
  summary += `  Successful Bookings:   ${successCount}\n`;
  summary += `  Failed Bookings:       ${failCount}\n`;
  summary += `    - Conflicts (409):   ${conflictCount}\n`;
  summary += `    - System Errors:     ${systemErrorCount}\n`;
  
  if (totalBookings > 0) {
    const successRate = (successCount / totalBookings * 100).toFixed(2);
    summary += `  Success Rate:          ${successRate}%\n`;
  }
  
  if (data.metrics.error_rate) {
    const errRate = (data.metrics.error_rate.values.rate * 100).toFixed(2);
    summary += `  Overall Error Rate:    ${errRate}%\n`;
  }
  summary += '\n';
  
  //Database query performance
  if (data.metrics.booking_duration && data.metrics.availability_duration) {
    summary += '┌─────────────────────────────────────────────────────────────┐\n';
    summary += '│ OPERATION-SPECIFIC PERFORMANCE                              │\n';
    summary += '└─────────────────────────────────────────────────────────────┘\n';
    
    summary += `  Booking Creation:\n`;
    summary += `    Avg: ${data.metrics.booking_duration && data.metrics.booking_duration.values && data.metrics.booking_duration.values.avg.toFixed(2)}ms\n`;
    summary += `    P95: ${data.metrics.booking_duration && data.metrics.booking_duration.values && data.metrics.booking_duration.values['p(95)'].toFixed(2)}ms\n`;
    
    summary += `  Availability Query:\n`;
    summary += `    Avg: ${data.metrics.availability_duration && data.metrics.availability_duration.values && data.metrics.availability_duration.values.avg.toFixed(2)}ms\n`;
    summary += `    P95: ${data.metrics.availability_duration && data.metrics.availability_duration.values && data.metrics.availability_duration.values['p(95)'].toFixed(2)}ms\n`;
    summary += '\n';
  }
  
  // Recommendations
  summary += '┌─────────────────────────────────────────────────────────────┐\n';
  summary += '│ RECOMMENDATIONS                                             │\n';
  summary += '└─────────────────────────────────────────────────────────────┘\n';
  
  const p95 = data.metrics.http_req_duration &&
              data.metrics.http_req_duration.values &&
              data.metrics.http_req_duration.values["p(95)"]
                ? data.metrics.http_req_duration.values["p(95)"]
                : 0;
  const errorRate = (data.metrics.error_rate && data.metrics.error_rate.values && data.metrics.error_rate.values.rate) || 0;
  
  if (p95 > 5000) {
    summary += '  ⚠ Consider optimizing database queries\n';
    summary += '  ⚠ Consider adding more database connection pool capacity\n';
  }
  
  if (errorRate > 0.1) {
    summary += '  ⚠ High error rate detected - review error logs\n';
    summary += '  ⚠ Consider implementing rate limiting\n';
  }
  
  if (systemErrorCount > conflictCount * 2) {
    summary += '  ⚠ System errors exceed conflicts - check infrastructure\n';
  }
  
  if (p95 < 2000 && errorRate < 0.05) {
    summary += '  ✓ System handled spike well - good performance\n';
  }
  
  summary += '\n';
  summary += '═══════════════════════════════════════════════════════════════\n';
  
  return summary;
}
