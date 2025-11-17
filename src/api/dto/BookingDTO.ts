import { z } from 'zod';

// Request validation schemas
export const recurrenceExceptionSchema = z.object({
  type: z.enum(['SKIP', 'CANCEL']),
  occurrence_time: z.string().datetime(),
  metadata: z.object({
    reason: z.string().optional(),
  }).optional(),
});

export const recurrenceRuleSchema = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  interval: z.number().int().positive().default(1),
  day: z.array(z.number().int().min(0).max(6)).default([]),
  until: z.string().datetime().nullable().optional(),
  exceptions: z.array(recurrenceExceptionSchema).optional(),
}).refine((val) => {
  const { frequency, day } = val;

  if (frequency === "DAILY") {
    return day.length === 0;
  }

  if (frequency === "WEEKLY") {
    return day.every((d) => d >= 0 && d <= 6);
  }

  if (frequency === "MONTHLY") {
    return day.every((d) => d >= 0 && d <= 30);
  }

  return true;
}, {
  message: "Invalid day[] values for the given frequency",
  path: ["day"],
}).optional();

export const createBookingSchema = z.object({
  resource_id: z.string().min(1, 'Resource ID is required'),
  start_time: z.string().datetime('Invalid start time format'),
  end_time: z.string().datetime('Invalid end time format'),
  recurrence_rule: recurrenceRuleSchema,
}).refine(
  (data) => new Date(data.start_time) >= new Date(),
  {
    message: 'Start time must be current or future',
    path: ['start_time'],
  }
).refine(
  (data) => new Date(data.end_time) > new Date(data.start_time),
  {
    message: 'End time must be after start time',
    path: ['end_time'],
  }
);

export const availabilityQuerySchema = z.object({
  start_time: z.string().datetime('Invalid start time format'),
  end_time: z.string().datetime('Invalid end time format'),
  page: z.string().optional().transform((val) => val ? parseInt(val, 10) : 1),
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 20),
}).refine(
  (data) => new Date(data.start_time) >= new Date(),
  {
    message: 'Start time must be current or future',
    path: ['start_time'],
  }
).refine(
  (data) => new Date(data.end_time) > new Date(data.start_time),
  {
    message: 'End time must be after start time',
    path: ['end_time'],
  }
);

// Response DTOs
export interface BookingResponseDTO {
  id: string;
  resource_id: string;
  start_time: string;
  end_time: string;
  recurrence_rule?: {
    frequency: string;
    interval: number;
    day: number[];
    until?: string;
  };
}

export interface ConflictResponseDTO {
  error: string;
  message: string;
  conflicting_meetings: Array<{
    meeting_id: string;
    start_time: string;
    end_time: string;
  }>;
  next_available: Array<{
    start_time: string;
    end_time: string;
  }>;
}

export interface AvailabilityResponseDTO {
  resource_id: string;
  availability: Array<{
    start_time: string;
    end_time: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type CreateBookingRequest = z.infer<typeof createBookingSchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
