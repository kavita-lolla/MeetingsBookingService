import dotenv from 'dotenv';

dotenv.config();

export const config = {
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    name: process.env.DATABASE_NAME || 'meetingbooking',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'admin123',
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9093').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'meetings-booking-service',
    groupId: process.env.KAFKA_GROUP_ID || 'meetings-booking-group',
    topicBookings: process.env.KAFKA_TOPIC_BOOKINGS || 'meeting-bookings',
  },
  cache: {
    ttlDays: parseInt(process.env.CACHE_TTL_DAYS || '30', 10),
    precomputeDays: parseInt(process.env.CACHE_PRECOMPUTE_DAYS || '30', 10),
  },
  lock: {
    ttlMs: parseInt(process.env.LOCK_TTL_MS || '5000', 10),
    retryDelayMs: parseInt(process.env.LOCK_RETRY_DELAY_MS || '100', 10),
    retryCount: parseInt(process.env.LOCK_RETRY_COUNT || '50', 10),
  },
  idempotency: {
    keyTtlHours: parseInt(process.env.IDEMPOTENCY_KEY_TTL_HOURS || '24', 10),
  },
};
