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
const dbQueryDuration = new Trend('db_query_duration');

// Test configuration for load test: 1000 bookings/hour
export const options = {
  scenarios: {
    load_test: {
      executor: 'constant-arrival-rate',
      rate: 1000, // 1000 requests
      timeUnit: '1h', // per hour
      duration: '1h', // test duration
      preAllocatedVUs: 50, // initial VUs
      maxVUs: 100, // maximum VUs if needed
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% under 500ms, 99% under 1s
    error_rate: ['rate<0.05'], // Error rate should be less than 5%
    http_req_failed: ['rate<0.05'], // Failed requests should be less than 5%
    successful_bookings: ['count>900'], // At least 900 successful bookings in 1 hour
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

// Generate sample resource IDs
const RESOURCES = Array.from({ length: 50 }, (_, i) => `LOAD_R${String(i + 1).padStart(3, '0')}`);

// Helper function to generate random date within next 30 days
function getRandomFutureDate() {
  const now = new Date();
  const daysAhead = Math.floor(Math.random() * 30) + 1;
  const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  
  // Random hour between 9 AM and 5 PM
  const hour = Math.floor(Math.random() * 8) + 9;
  futureDate.setHours(hour, 0, 0, 0);
  
  return futureDate;
}

// Helper function to generate idempotency key
function generateIdempotencyKey() {
  return `load-test-${Date.now()}-${randomString(16)}`;
}

export default function () {
  const resourceId = RESOURCES[Math.floor(Math.random() * RESOURCES.length)];
  const startTime = getRandomFutureDate();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration
  
  const idempotencyKey = generateIdempotencyKey();
  
  // Decide if this should be a recurring meeting (30% chance)
  const isRecurring = Math.random() < 0.3;
  
  const payload = {
    resource_id: resourceId,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
  };
  
  if (isRecurring) {
    const frequencies = ['DAILY', 'WEEKLY', 'MONTHLY'];
    payload.recurrence_rule = {
      frequency: frequencies[Math.floor(Math.random() * frequencies.length)],
      interval: 1,
      day: [],
      until: new Date(startTime.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
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
    { headers }
  );
  const createDuration = Date.now() - createStart;
  
  bookingDuration.add(createDuration);
  
  const createSuccess = check(createResponse, {
    'booking created successfully': (r) => r.status === 200 || r.status === 409,
    'response has id or error': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined || body.error !== undefined;
      } catch (e) {
        return false;
      }
    },
  });
  
  if (createResponse.status === 200) {
    successfulBookings.add(1);
  } else {
    failedBookings.add(1);
    errorRate.add(1);
  }
  
  sleep(0.5); // Small pause between operations
  
  // Test 2: Query availability (50% of requests)
  if (Math.random() < 0.5) {
    const queryStart = getRandomFutureDate();
    const queryEnd = new Date(queryStart.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    const availStart = Date.now();
    const availResponse = http.get(
      `${BASE_URL}/api/availability/${resourceId}?start_time=${queryStart.toISOString()}&end_time=${queryEnd.toISOString()}`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    const availDuration = Date.now() - availStart;
    
    availabilityDuration.add(availDuration);
    
    check(availResponse, {
      'availability query successful': (r) => r.status === 200,
      'availability has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.availability !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
    
    if (availResponse.status !== 200) {
      errorRate.add(1);
    }
  }
  
  // Random sleep to simulate realistic user behavior
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

// Setup function - runs once at the beginning
export function setup() {
  console.log('Starting load test: 1000 bookings/hour');
  console.log(`Target URL: ${BASE_URL}`);
  console.log(`Test duration: 1 hour`);
  
  // Health check
  const healthResponse = http.get(`${BASE_URL}/api/health`);
  if (healthResponse.status !== 200) {
    throw new Error('API health check failed - service may not be running');
  }
  
  return { startTime: new Date().toISOString() };
}

// Teardown function - runs once at the end
export function teardown(data) {
  console.log('Load test completed');
  console.log(`Started at: ${data.startTime}`);
  console.log(`Completed at: ${new Date().toISOString()}`);
}

// Handle summary to export detailed results
export function handleSummary(data) {
  return {
    'load-test-results.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  const enableColors = options.enableColors || false;
  
  let summary = `\n${indent}Load Test Summary\n`;
  summary += `${indent}================\n\n`;
  
  // Duration
  const duration = data.state.testRunDurationMs / 1000;
  summary += `${indent}Test Duration: ${duration.toFixed(2)}s\n\n`;
  
  // HTTP metrics
  if (data.metrics.http_reqs) {
    summary += `${indent}HTTP Requests:\n`;
    summary += `${indent}  Total: ${data.metrics.http_reqs.values.count}\n`;
    summary += `${indent}  Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s\n\n`;
  }
  
  // Response times
  if (data.metrics.http_req_duration) {
    summary += `${indent}Response Times:\n`;
    summary += `${indent}  Avg: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
    summary += `${indent}  Min: ${data.metrics.http_req_duration.values.min.toFixed(2)}ms\n`;
    summary += `${indent}  Max: ${data.metrics.http_req_duration.values.max.toFixed(2)}ms\n`;
    summary += `${indent}  P95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
    summary += `${indent}  P99: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n\n`;
  }
  
  // Error rate
  if (data.metrics.error_rate) {
    summary += `${indent}Error Rate: ${(data.metrics.error_rate.values.rate * 100).toFixed(2)}%\n\n`;
  }
  
  // Custom metrics
  if (data.metrics.successful_bookings) {
    summary += `${indent}Successful Bookings: ${data.metrics.successful_bookings.values.count}\n`;
  }
  if (data.metrics.failed_bookings) {
    summary += `${indent}Failed Bookings: ${data.metrics.failed_bookings.values.count}\n\n`;
  }
  
  return summary;
}
