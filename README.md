# Meeting Booking Service

A production-ready, scalable meeting booking service built with Node.js, TypeScript, PostgreSQL, Redis, and Kafka. The service provides conflict detection, recurring meetings support, intelligent caching, and event-driven architecture.

## Features

- **Conflict Detection**: Advanced algorithm to prevent double bookings with database-level exclusion constraints
- **Recurring Meetings**: Full support for recurring meetings with customizable patterns (daily, weekly, monthly, yearly)
- **Exception Handling**: Skip or cancel specific occurrences in recurring meetings
- **Redis Caching**: 30-day precomputed cache with automatic invalidation and graceful fallback
- **Event-Driven Updates**: Kafka streaming for real-time cache updates
- **Distributed Locking**: Redis-based locking to prevent race conditions
- **Idempotency**: Request idempotency to prevent duplicate bookings
- **High Availability**: Graceful degradation when Redis is unavailable
- **Production-Ready**: Comprehensive logging, error handling, and health checks

## Architecture

### System Components

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│   Express    │────▶│  PostgreSQL │
└─────────────┘     │   REST API   │     └─────────────┘
                    └──────────────┘            │
                           │                    │
                           │                    │
                    ┌──────▼──────┐      ┌─────▼──────┐
                    │    Redis    │      │   Kafka    │
                    │   Caching   │      │  Streaming │
                    └─────────────┘      └────────────┘
                           │                    │
                           │                    │
                    ┌──────▼────────────────────▼─────┐
                    │      Cache Scheduler            │
                    │   (30th Day Population)         │
                    └─────────────────────────────────┘
```

### Technology Stack

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Web Framework**: Express.js
- **Database**: PostgreSQL 16 (with btree_gist extension)
- **Cache**: Redis 7
- **Message Broker**: Apache Kafka
- **Validation**: Zod
- **Testing**: Jest, Supertest
- **Containerization**: Docker & Docker Compose

### Design Patterns

- **Singleton Pattern**: Service instances (Database, Redis, Kafka clients)
- **Repository Pattern**: Data access abstraction
- **Factory Pattern**: Object creation for complex entities
- **Strategy Pattern**: Recurrence rule expansion
- **Middleware Pattern**: Request processing pipeline

### SOLID Principles

- **Single Responsibility**: Each class has one well-defined purpose
- **Open/Closed**: Extensible through interfaces and abstract classes
- **Liskov Substitution**: Proper inheritance hierarchies
- **Interface Segregation**: Focused, specific interfaces
- **Dependency Inversion**: Dependency injection throughout

## Directory Structure

```
MeetingsBookingService/
├── src/
│   ├── api/
│   │   ├── controllers/        # HTTP request handlers
│   │   ├── dto/                # Data transfer objects & validation
│   │   └── routes/             # API route definitions
│   ├── application/
│   │   └── services/           # Business logic layer
│   ├── domain/
│   │   ├── models/             # Domain entities
│   │   └── services/           # Domain services
│   ├── infrastructure/
│   │   ├── cache/              # Redis client & lock manager
│   │   ├── database/           # PostgreSQL client
│   │   │   └── init/           # DB initialization scripts
│   │   ├── logging/            # Winston logger
│   │   ├── messaging/          # Kafka producer & consumer
│   │   ├── middleware/         # Express middleware
│   │   ├── repositories/       # Data access layer
│   │   └── scheduler/          # Cron jobs
│   ├── config/                 # Configuration management
│   ├── __tests__/              # Test suites
│   │   ├── unit/               # Unit tests
│   │   └── e2e/                # End-to-end tests
│   └── index.ts                # Application entry point
├── infrastructure/
│   └── database/
│       └── init/               # Database initialization SQL
├── docker-compose.yml          # Docker services configuration
├── Dockerfile                  # Application container
├── package.json                # Node.js dependencies
├── tsconfig.json               # TypeScript configuration
└── jest.config.js              # Jest test configuration
```

## Conflict Detection Algorithm

### Database-Level Prevention

PostgreSQL exclusion constraints using the `btree_gist` extension:

```sql
EXCLUDE USING GIST (
    resource_id WITH =,
    tstzrange(start_time, end_time) WITH &&
)
```

This prevents overlapping meetings at the database level by:
1. Checking if `resource_id` matches (WITH =)
2. Checking if time ranges overlap (WITH &&)
3. Rejecting the insert if both conditions are true

### Application-Level Detection

For recurring meetings, the service:

1. **Expands Recurrence Pattern**: Uses RRule library to generate all occurrences
2. **Checks Each Occurrence**: Queries database for conflicts at each occurrence time
3. **Handles Exceptions**: Skips dates marked as SKIP or CANCEL
4. **Reports Conflicts**: Returns all conflicting meetings with details
5. **Suggests Alternatives**: Finds next available time slots

### Distributed Locking

Redis-based distributed locks prevent race conditions:

```typescript
// Acquire lock for resource
const locked = await lockManager.acquireLock(resourceId, identifier);

// Perform booking operation
const result = await createBooking(...);

// Release lock
await lockManager.releaseLock(resourceId, identifier);
```

Lock features:
- **TTL**: Automatic expiration (default 5 seconds)
- **Retry Logic**: Configurable retry attempts with exponential backoff
- **Ownership Verification**: Lua script ensures only lock owner can release

## Caching Strategy

### 30-Day Precomputation

On startup, the service:
1. Fetches all meetings from database
2. Expands recurring meetings for next 30 days
3. Stores in Redis with key pattern: `meetings:{resourceId}:{date}`
4. Sets expiration to 11:59 PM of each day

### Cache Invalidation

- **Time-based**: Keys automatically expire at end of day
- **Event-driven**: Kafka events trigger cache updates for new bookings
- **Scheduled**: Cron job populates 30th day cache at 11:30 PM daily

### Graceful Degradation

If Redis is unavailable:
1. Service continues to operate
2. Falls back to database queries
3. Logs warnings for monitoring
4. Automatically recovers when Redis reconnects

## API Documentation

### POST /api/bookings

Create a new meeting booking.

**Request Headers:**
- `Idempotency-Key`: Required. Unique identifier to prevent duplicate requests

**Request Body:**
```json
{
  "resource_id": "R123",
  "start_time": "2025-08-10T09:00:00Z",
  "end_time": "2025-08-10T10:00:00Z",
  "recurrence_rule": {
    "frequency": "WEEKLY",
    "interval": 1,
    "day": [2, 5],
    "until": "2025-10-10T10:00:00Z",
    "exceptions": [{
      "type": "CANCEL",
      "occurrence_time": "2025-09-19T09:00:00Z",
      "metadata": { "reason": "client canceled" }
    }]
  }
}
```

**Success Response (200 OK):**
```json
{
  "id": "M123",
  "resource_id": "R123",
  "start_time": "2025-08-10T09:00:00Z",
  "end_time": "2025-08-10T10:00:00Z",
  "recurrence_rule": {
    "frequency": "WEEKLY",
    "interval": 1,
    "day": [2, 5],
    "until": "2025-10-10T10:00:00Z"
  }
}
```

**Conflict Response (409 Conflict):**
```json
{
  "error": "conflict",
  "message": "The requested time overlaps with another meeting.",
  "conflicting_meetings": [
    {
      "meeting_id": "M456",
      "start_time": "2025-08-10T09:00:00Z",
      "end_time": "2025-08-10T10:00:00Z"
    }
  ],
  "next_available": [
    {
      "start_time": "2025-08-10T10:00:00Z",
      "end_time": "2025-08-10T11:00:00Z"
    }
  ]
}
```

### GET /api/availability/:resource_id

Get available time slots for a resource.

**Query Parameters:**
- `start_time`: ISO 8601 datetime (required)
- `end_time`: ISO 8601 datetime (required)
- `page`: Page number (optional, default: 1)
- `limit`: Items per page (optional, default: 20)

**Example:**
```
GET /api/availability/R123?start_time=2025-08-10T00:00:00Z&end_time=2025-08-10T23:59:59Z&page=1&limit=20
```

**Success Response (200 OK):**
```json
{
  "resource_id": "R123",
  "availability": [
    {
      "start_time": "2025-08-10T09:00:00Z",
      "end_time": "2025-08-10T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20.x (for local development)
- npm or yarn

### Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd MeetingsBookingService
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start services with Docker:**
```bash
colima start
docker-compose up --build
```

This will start:
- PostgreSQL (port 5432)
- Redis (port 6379)
- Kafka & Zookeeper (ports 9092, 9093, 2181)
- Application (port 3000)

5. **Check service health:**
```bash
curl http://localhost:3000/api/health
```

### Development

**Run in development mode:**
```bash
npm run dev
```

**Build TypeScript:**
```bash
npm run build
```

**Run tests:**
```bash
# Unit tests
npm run test:unit

# E2E tests (requires services running)
npm run test:e2e

# All tests with coverage
npm test
```

**View logs:**
```bash
docker-compose logs -f app
```

## Testing

### Unit Tests

Run unit tests for individual components:

```bash
npm run test:unit
```

Unit tests cover:
- RecurrenceService (daily, weekly, monthly, yearly patterns)
- Date calculations and occurrence expansion
- Edge cases and exception handling

### E2E Tests

End-to-end tests require services to be running:

```bash
# Start services
docker-compose up -d

# Run E2E tests
npm run test:e2e
```

E2E tests cover:
- Booking creation (recurring and non-recurring)
- Conflict detection and resolution
- Input validation scenarios
- Cache invalidation and data consistency
- Idempotency key handling

### Database Test Data Management

#### Setup Test Data

Populate the database with sample data before running tests:

```bash
# Using psql directly
docker-compose exec postgres psql -U admin -d meetingbooking -f /infrastructure/database/setup-test-data.sql

# Or using the mounted volume
docker-compose exec postgres psql -U admin -d meetingbooking < infrastructure/database/setup-test-data.sql
```

The setup script creates:
- Non-recurring test meetings
- Recurring meetings (daily, weekly, monthly, yearly)
- Infinite recurring meetings
- Meetings with exceptions (SKIP/CANCEL)

#### Teardown Test Data

Clean up all test data after tests complete:

```bash
# Using psql directly
docker-compose exec postgres psql -U admin -d meetingbooking -f /infrastructure/database/teardown-test-data.sql

# Or using the mounted volume
docker-compose exec postgres psql -U admin -d meetingbooking < infrastructure/database/teardown-test-data.sql
```

The teardown script removes:
- All test meetings (resource_id starting with TEST_ or R_)
- Associated recurrence rules and exceptions
- Idempotency cache entries
- Old test data (>7 days)

#### Automated Test Workflow

For automated testing with setup and teardown:

```bash
# Complete test cycle
docker-compose exec postgres psql -U admin -d meetingbooking < infrastructure/database/setup-test-data.sql && \
npm run test:e2e && \
docker-compose exec postgres psql -U admin -d meetingbooking < infrastructure/database/teardown-test-data.sql
```

## Load Testing with k6

The service includes comprehensive k6 load testing scripts to measure performance under various conditions.

### Prerequisites

Install k6:

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

### Load Test (1000 bookings/hour)

Simulates steady production load over 1 hour:

```bash
# Run load test
k6 run k6/load-test.js

# With custom API URL
k6 run --env API_URL=http://localhost:3000 k6/load-test.js

# With shorter duration (for testing)
k6 run --duration 5m k6/load-test.js
```

**Load Test Characteristics:**
- **Duration**: 1 hour
- **Rate**: 1000 requests/hour (constant arrival rate)
- **Virtual Users**: 50-100 (auto-scaled)
- **Operations**: 
  - 70% booking creation
  - 30% availability queries
- **Test Mix**: 30% recurring meetings, 70% single meetings

**Success Criteria:**
- 95% of requests complete under 500ms
- 99% of requests complete under 1000ms
- Error rate < 5%
- At least 900 successful bookings in 1 hour

**Results:**
Results are saved to `load-test-results.json` for analysis.

### Spike Test (10,000 requests in 30 seconds)

Tests system behavior under sudden traffic bursts:

```bash
# Run spike test
k6 run k6/spike-test.js

# With custom API URL
k6 run --env API_URL=http://localhost:3000 k6/spike-test.js
```

**Spike Test Stages:**
1. **Ramp Up** (10s): 0 → 50 VUs
2. **SPIKE** (30s): 50 → 500 VUs (peak load)
3. **Ramp Down** (10s): 500 → 50 VUs
4. **Recovery** (20s): 50 → 0 VUs

**Spike Test Characteristics:**
- **Peak Load**: ~10,000 requests in 30 seconds
- **Resources**: 20 test resources (higher contention)
- **Operations**:
  - 70% booking creation
  - 30% availability queries
- **Test Mix**: 10% recurring meetings (simpler during spike)

**Success Criteria:**
- 95% of requests complete under 2 seconds
- 99% of requests complete under 5 seconds
- Error rate < 15% (more lenient during spike)
- Failed requests < 20%

**Results:**
- Detailed summary printed to console
- Results saved to `spike-test-results.json`
- Summary saved to `spike-test-summary.txt`

### Interpreting k6 Results

#### Key Metrics

**Response Times:**
- `http_req_duration`: End-to-end request time
- `http_req_waiting`: Time to first byte (TTFB)
- `http_req_sending`: Time spent sending data
- `http_req_receiving`: Time spent receiving data

**Throughput:**
- `http_reqs`: Total number of requests
- `iterations`: Number of VU iterations completed

**Errors:**
- `http_req_failed`: Percentage of failed requests
- `error_rate`: Custom error rate metric
- `conflict_errors`: Number of 409 conflict responses
- `system_errors`: Number of 5xx errors

**Custom Metrics:**
- `booking_duration`: Booking creation response time
- `availability_duration`: Availability query response time
- `successful_bookings`: Count of successful bookings
- `failed_bookings`: Count of failed bookings

#### Performance Thresholds

**Load Test (Normal Operation):**
```
✓ P95 < 500ms   → Excellent performance
✓ P99 < 1000ms  → Good user experience
✓ Error rate < 5% → System stability
```

**Spike Test (Under Stress):**
```
✓ P95 < 2000ms   → System handles spike
✓ P99 < 5000ms   → Acceptable degradation
✓ Error rate < 15% → Graceful handling
```

### Database Performance Monitoring

Monitor database during load tests:

```bash
# Connection statistics
docker-compose exec postgres psql -U admin -d meetingbooking -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'meetingbooking';"

# Long-running queries
docker-compose exec postgres psql -U admin -d meetingbooking -c "SELECT pid, now() - query_start as duration, query FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '1 second';"

# Cache hit rate
docker-compose exec postgres psql -U admin -d meetingbooking -c "SELECT sum(heap_blks_read) as heap_read, sum(heap_blks_hit) as heap_hit, sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as ratio FROM pg_statio_user_tables;"

# Index usage
docker-compose exec postgres psql -U admin -d meetingbooking -c "SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY idx_scan DESC;"
```

### Redis Performance Monitoring

Monitor Redis during load tests:

```bash
# Redis stats
docker-compose exec redis redis-cli INFO stats

# Monitor commands in real-time
docker-compose exec redis redis-cli MONITOR

# Check memory usage
docker-compose exec redis redis-cli INFO memory

# Get cache hit rate
docker-compose exec redis redis-cli INFO stats | grep keyspace
```

### Cleanup After Load Tests

Remove test data created during load tests:

```bash
# Clean load test data
docker-compose exec postgres psql -U admin -d meetingbooking -c "DELETE FROM meetings WHERE resource_id LIKE 'LOAD_%';"

# Clean spike test data
docker-compose exec postgres psql -U admin -d meetingbooking -c "DELETE FROM meetings WHERE resource_id LIKE 'SPIKE_%';"

# Flush Redis cache
docker-compose exec redis redis-cli FLUSHDB
```

### Best Practices for Load Testing

1. **Test Environment**: Use a staging environment that mirrors production
2. **Gradual Ramp-Up**: Start with smaller tests before full load
3. **Monitor Resources**: Watch CPU, memory, disk I/O during tests
4. **Database Connection Pool**: Ensure pool size matches expected load
5. **Clean Data**: Always clean up test data after tests
6. **Baseline Metrics**: Run tests multiple times to establish baseline
7. **Document Results**: Keep records of test results over time

## Configuration

Environment variables (`.env`):

```env
# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=meetingbooking
DATABASE_USER=admin
DATABASE_PASSWORD=admin123

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka
KAFKA_BROKERS=localhost:9093
KAFKA_TOPIC_BOOKINGS=meeting-bookings

# Cache
CACHE_TTL_DAYS=30

# Locking
LOCK_TTL_MS=5000
LOCK_RETRY_COUNT=50

# Idempotency
IDEMPOTENCY_KEY_TTL_HOURS=24
```

## Database Schema

### meetings
- `id` (UUID, PK)
- `resource_id` (VARCHAR)
- `start_time` (TIMESTAMPTZ)
- `end_time` (TIMESTAMPTZ)
- `created_at`, `updated_at` (TIMESTAMPTZ)
- **Exclusion Constraint**: Prevents overlapping bookings

### recurrence_rules
- `id` (UUID, PK)
- `meeting_id` (UUID, FK)
- `frequency` (VARCHAR: DAILY, WEEKLY, MONTHLY, YEARLY)
- `interval` (INTEGER)
- `by_day` (INTEGER[]: 0-6 for days of week - 0 for monday)
- `until_date` (TIMESTAMPTZ)

### recurrence_exceptions
- `id` (UUID, PK)
- `recurrence_rule_id` (UUID, FK)
- `exception_type` (VARCHAR: SKIP, CANCEL)
- `exception_date` (TIMESTAMPTZ)
- `reason` (TEXT)

### idempotency_keys
- `id` (UUID, PK)
- `idempotency_key` (VARCHAR, UNIQUE)
- `request_hash` (VARCHAR)
- `response_status` (INTEGER)
- `response_body` (JSONB)
- `expires_at` (TIMESTAMPTZ)

## Monitoring & Observability

### Logs

Winston logger with multiple transports:
- Console (colored, formatted)
- File (`logs/combined.log`)
- Error file (`logs/error.log`)

### Health Checks

```bash
# Application health
curl http://localhost:3000/api/health

# Database health
docker-compose exec postgres pg_isready

# Redis health
docker-compose exec redis redis-cli ping

# Kafka health
docker-compose exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092
```

## Performance Considerations

- **Database Indexing**: GiST indexes on time ranges for fast conflict detection
- **Connection Pooling**: PostgreSQL pool (min: 2, max: 10 connections)
- **Caching Layer**: Redis reduces database load by ~80% for read operations
- **Async Processing**: Kafka decouples cache updates from request handling
- **Pagination**: Large result sets paginated to prevent memory issues

## Security

- **Input Validation**: Zod schemas validate all incoming requests
- **SQL Injection Prevention**: Parameterized queries throughout
- **Rate Limiting**: Can be added via middleware (see Express rate-limit)
- **Authentication**: Can be integrated with JWT or OAuth2
- **CORS**: Configurable in Express middleware

## Troubleshooting

### Redis Connection Issues
```bash
# Check Redis logs
docker-compose logs redis

# Restart Redis
docker-compose restart redis
```

### Database Migration Issues
```bash
# Access PostgreSQL
docker-compose exec postgres psql -U admin -d meetingbooking

# Check tables
\dt

# Check constraints
\d meetings
```

### Kafka Issues
```bash
# Check Kafka logs
docker-compose logs kafka

# List topics
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License

## Support

For issues and questions:
- Create an issue in the repository
- Check existing documentation
- Review logs for error details
