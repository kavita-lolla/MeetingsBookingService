import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { AvailabilityController } from '../controllers/AvailabilityController';
import { IdempotencyMiddleware } from '../../infrastructure/middleware/IdempotencyMiddleware';

const router = Router();

const bookingController = BookingController.getInstance();
const availabilityController = AvailabilityController.getInstance();
const idempotencyMiddleware = IdempotencyMiddleware.getInstance();

// POST /bookings - Create a new booking
router.post(
  '/bookings',
  idempotencyMiddleware.handle,
  bookingController.createBooking
);

// GET /availability/:resource_id - Get availability for a resource
router.get(
  '/availability/:resource_id',
  availabilityController.getAvailability
);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

export default router;
