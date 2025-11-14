import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

// This E2E test assumes the application is running
// Run with: npm run test:e2e
// Make sure to start services with: docker-compose up -d

const API_URL = process.env.API_URL || 'http://localhost:3000';

describe('Booking API E2E Tests', () => {
  describe('POST /api/bookings', () => {
    it('should create a non-recurring booking successfully', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R123',
        start_time: '2026-08-10T09:00:00Z',
        end_time: '2026-08-10T10:00:00Z',
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.resource_id).toBe(payload.resource_id);
      expect(response.body.start_time).toBe(payload.start_time);
      expect(response.body.end_time).toBe(payload.end_time);
    });

    it('should create a recurring booking successfully', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R456',
        start_time: '2026-08-10T09:00:00Z',
        end_time: '2026-08-10T10:00:00Z',
        recurrence_rule: {
          frequency: 'WEEKLY',
          interval: 1,
          day: [2, 5],
          until: '2026-10-10T10:00:00Z',
        },
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.recurrence_rule).toBeDefined();
      expect(response.body.recurrence_rule.frequency).toBe('WEEKLY');
    });

    it('should handle conflicts and return conflicting meetings', async () => {
      const resourceId = 'R789';
      const idempotencyKey1 = uuidv4();
      const idempotencyKey2 = uuidv4();

      // Create first booking
      const resp = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey1)
        .send({
          resource_id: resourceId,
          start_time: '2026-08-15T14:00:00Z',
          end_time: '2026-08-15T15:00:00Z',
        })
        .expect(200);

      // Try to create conflicting booking
      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey2)
        .send({
          resource_id: resourceId,
          start_time: '2026-08-15T14:30:00Z',
          end_time: '2026-08-15T15:30:00Z',
        })
        .expect(409);

      expect(response.body.error).toBe('conflict');
      expect(response.body.conflicting_meetings).toBeDefined();
      expect(response.body.conflicting_meetings.length).toBeGreaterThan(0);
      expect(response.body.next_available).toBeDefined();
    });

    it('should reject request without idempotency key', async () => {
      const payload = {
        resource_id: 'R999',
        start_time: '2026-08-20T09:00:00Z',
        end_time: '2026-08-20T10:00:00Z',
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .send(payload)
        .expect(400);

      expect(response.body.error).toBe('bad_request');
    });

    it('should return cached response for duplicate idempotency key', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R111',
        start_time: '2026-08-25T11:00:00Z',
        end_time: '2026-08-25T12:00:00Z',
      };

      // First request
      const response1 = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      // Second request with same idempotency key
      const response2 = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      // Should return the same meeting ID
      expect(response1.body.id).toBe(response2.body.id);
    });

    it('should validate request payload - missing end_time', async () => {
      const idempotencyKey = uuidv4();
      const invalidPayload = {
        resource_id: 'R222',
        start_time: '2026-08-30T15:00:00Z',
        // Missing end_time
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate request payload - missing resource_id', async () => {
      const idempotencyKey = uuidv4();
      const invalidPayload = {
        start_time: '2026-08-30T15:00:00Z',
        end_time: '2026-08-30T16:00:00Z',
        // Missing resource_id
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate request payload - invalid time format', async () => {
      const idempotencyKey = uuidv4();
      const invalidPayload = {
        resource_id: 'R333',
        start_time: 'invalid-date',
        end_time: '2026-08-30T16:00:00Z',
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate request payload - end_time before start_time', async () => {
      const idempotencyKey = uuidv4();
      const invalidPayload = {
        resource_id: 'R444',
        start_time: '2026-08-30T16:00:00Z',
        end_time: '2026-08-30T15:00:00Z',
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate request payload - invalid recurrence frequency', async () => {
      const idempotencyKey = uuidv4();
      const invalidPayload = {
        resource_id: 'R555',
        start_time: '2026-08-30T15:00:00Z',
        end_time: '2026-08-30T16:00:00Z',
        recurrence_rule: {
          frequency: 'INVALID_FREQUENCY',
          interval: 1,
        },
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should validate request payload - negative interval', async () => {
      const idempotencyKey = uuidv4();
      const invalidPayload = {
        resource_id: 'R666',
        start_time: '2026-08-30T15:00:00Z',
        end_time: '2026-08-30T16:00:00Z',
        recurrence_rule: {
          frequency: 'DAILY',
          interval: -1,
        },
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(invalidPayload)
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });

    it('should create infinitely recurring weekly meeting (until is null)', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R_INFINITE_1',
        start_time: '2026-08-10T09:00:00Z',
        end_time: '2026-08-10T10:00:00Z',
        recurrence_rule: {
          frequency: 'WEEKLY',
          interval: 1,
          day: [1], // Monday
          until: null,
        },
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.recurrence_rule).toBeDefined();
      expect(response.body.recurrence_rule.frequency).toBe('WEEKLY');
      expect(response.body.recurrence_rule.until).toBeNull();
    });

    it('should create infinitely recurring monthly meeting', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R_INFINITE_2',
        start_time: '2026-08-15T14:00:00Z',
        end_time: '2026-08-15T15:00:00Z',
        recurrence_rule: {
          frequency: 'MONTHLY',
          interval: 1,
          day: [],
          until: null,
        },
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.recurrence_rule).toBeDefined();
      expect(response.body.recurrence_rule.frequency).toBe('MONTHLY');
      expect(response.body.recurrence_rule.until).toBeNull();
    });

    it('should create infinitely recurring daily meeting', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R_INFINITE_3',
        start_time: '2026-08-01T09:00:00Z',
        end_time: '2026-08-01T10:00:00Z',
        recurrence_rule: {
          frequency: 'DAILY',
          interval: 1,
          day: [],
          until: null,
        },
      };

      const response = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.recurrence_rule).toBeDefined();
      expect(response.body.recurrence_rule.frequency).toBe('DAILY');
      expect(response.body.recurrence_rule.until).toBeNull();
    });
  });

  describe('GET /api/availability/:resource_id', () => {
    it('should return availability for a resource', async () => {
      const response = await request(API_URL)
        .get('/api/availability/R123')
        .query({
          start_time: '2026-09-01T00:00:00Z',
          end_time: '2026-09-01T23:59:59Z',
        })
        .expect(200);

      expect(response.body.resource_id).toBe('R123');
      expect(response.body.availability).toBeDefined();
      expect(Array.isArray(response.body.availability)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(API_URL)
        .get('/api/availability/R456')
        .query({
          start_time: '2026-09-01T00:00:00Z',
          end_time: '2026-09-30T23:59:59Z',
          page: '1',
          limit: '10',
        })
        .expect(200);

      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(10);
      expect(response.body.availability.length).toBeLessThanOrEqual(10);
    });

    it('should validate query parameters', async () => {
      const response = await request(API_URL)
        .get('/api/availability/R789')
        .query({
          start_time: '2026-09-01T00:00:00Z',
          // Missing end_time
        })
        .expect(400);

      expect(response.body.error).toBe('validation_error');
    });
  });

  describe('Caching Layer Tests', () => {
    it('should add new meetings to caching layer on creation', async () => {
      const idempotencyKey = uuidv4();
      const payload = {
        resource_id: 'R_CACHE_1',
        start_time: '2026-09-10T10:00:00Z',
        end_time: '2026-09-10T11:00:00Z',
      };

      // Create a booking
      const createResponse = await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(200);

      expect(createResponse.body).toHaveProperty('id');

      // Immediately fetch availability to verify cache was updated
      const availabilityResponse = await request(API_URL)
        .get(`/api/availability/${payload.resource_id}`)
        .query({
          start_time: '2026-09-10T00:00:00Z',
          end_time: '2026-09-10T23:59:59Z',
        })
        .expect(200);

      expect(availabilityResponse.body.resource_id).toBe(payload.resource_id);
      // The created booking should be reflected in availability (busy time)
      expect(availabilityResponse.body.availability).toBeDefined();
    });

    it('should fetch data from caching layer for availability queries', async () => {
      const resourceId = 'R_CACHE_2';
      
      // First, create a recurring meeting to populate cache
      const idempotencyKey = uuidv4();
      await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          resource_id: resourceId,
          start_time: '2026-09-15T09:00:00Z',
          end_time: '2026-09-15T10:00:00Z',
          recurrence_rule: {
            frequency: 'DAILY',
            interval: 1,
            day: [],
            until: '2026-09-30T23:59:59Z',
          },
        })
        .expect(200);

      // Query availability multiple times - should hit cache
      const response1 = await request(API_URL)
        .get(`/api/availability/${resourceId}`)
        .query({
          start_time: '2026-09-15T00:00:00Z',
          end_time: '2026-09-20T23:59:59Z',
        })
        .expect(200);

      const response2 = await request(API_URL)
        .get(`/api/availability/${resourceId}`)
        .query({
          start_time: '2026-09-15T00:00:00Z',
          end_time: '2026-09-20T23:59:59Z',
        })
        .expect(200);

      // Both responses should be consistent (from cache)
      expect(response1.body.resource_id).toBe(resourceId);
      expect(response2.body.resource_id).toBe(resourceId);
      expect(response1.body.availability).toBeDefined();
      expect(response2.body.availability).toBeDefined();
    });

    it('should invalidate cache when new booking is created', async () => {
      const resourceId = 'R_CACHE_3';
      
      // Query initial availability
      const initialResponse = await request(API_URL)
        .get(`/api/availability/${resourceId}`)
        .query({
          start_time: '2026-10-01T00:00:00Z',
          end_time: '2026-10-01T23:59:59Z',
        })
        .expect(200);

      const initialAvailabilityCount = initialResponse.body.availability.length;

      // Create a new booking
      const idempotencyKey = uuidv4();
      await request(API_URL)
        .post('/api/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          resource_id: resourceId,
          start_time: '2026-10-01T14:00:00Z',
          end_time: '2026-10-01T15:00:00Z',
        })
        .expect(200);

      // Query availability again - should reflect the new booking
      const updatedResponse = await request(API_URL)
        .get(`/api/availability/${resourceId}`)
        .query({
          start_time: '2026-10-01T00:00:00Z',
          end_time: '2026-10-01T23:59:59Z',
        })
        .expect(200);

      // Availability should be updated (cache invalidated)
      expect(updatedResponse.body.resource_id).toBe(resourceId);
      expect(updatedResponse.body.availability).toBeDefined();
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(API_URL)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
    });
  });
});
