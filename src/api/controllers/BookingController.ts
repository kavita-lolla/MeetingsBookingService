import { Request, Response } from 'express';
import { BookingService, BookingConflict } from '../../application/services/BookingService';
import {
  createBookingSchema,
  BookingResponseDTO,
  ConflictResponseDTO,
} from '../dto/BookingDTO';
import {
  MeetingWithRecurrence,
  RecurrenceRule,
  RecurrenceException,
  RecurrenceFrequency,
  ExceptionType,
} from '../../domain/models/Meeting';
import { logger } from '../../infrastructure/logging/Logger';
import { ZodError } from 'zod';

export class BookingController {
  private static instance: BookingController;
  private bookingService: BookingService;

  private constructor() {
    this.bookingService = BookingService.getInstance();
  }

  public static getInstance(): BookingController {
    if (!BookingController.instance) {
      BookingController.instance = new BookingController();
    }
    return BookingController.instance;
  }

  public createBooking = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request
      const validatedData = createBookingSchema.parse(req.body);

      const startTime = new Date(validatedData.start_time);
      const endTime = new Date(validatedData.end_time);

      let recurrenceRule: RecurrenceRule | undefined;
      let exceptions: RecurrenceException[] | undefined;

      if (validatedData.recurrence_rule) {
        const rr = validatedData.recurrence_rule;
        recurrenceRule = {
          frequency: rr.frequency as RecurrenceFrequency,
          interval: rr.interval,
          byDay: rr.day,
          until: rr.until ? new Date(rr.until) : undefined,
        };

        // Process exceptions
        if (rr.exceptions && rr.exceptions.length > 0) {
          exceptions = rr.exceptions.map((exc) => ({
            exceptionType: exc.type as ExceptionType,
            exceptionDate: new Date(exc.occurrence_time),
            reason: exc.metadata?.reason,
          }));
        }
      }

      const result = await this.bookingService.createBooking(
        validatedData.resource_id,
        startTime,
        endTime,
        recurrenceRule,
        exceptions
      );

      // Check if result is a conflict
      if ('conflictingMeetings' in result) {
        const conflict = result as BookingConflict;
        const response: ConflictResponseDTO = {
          error: 'conflict',
          message: 'The requested time overlaps with another meeting.',
          conflicting_meetings: conflict.conflictingMeetings.map((m) => ({
            meeting_id: m.meetingId,
            start_time: m.startTime.toISOString(),
            end_time: m.endTime.toISOString(),
          })),
          next_available: conflict.nextAvailable.map((slot) => ({
            start_time: slot.startTime.toISOString(),
            end_time: slot.endTime.toISOString(),
          })),
        };

        res.status(409).json(response);
        return;
      }

      // Success - format response
      const meeting = result as MeetingWithRecurrence;
      const response: BookingResponseDTO = {
        id: meeting.id,
        resource_id: meeting.resourceId,
        start_time: meeting.startTime.toISOString(),
        end_time: meeting.endTime.toISOString(),
      };

      if (meeting.recurrenceRule) {
        response.recurrence_rule = {
          frequency: meeting.recurrenceRule.frequency,
          interval: meeting.recurrenceRule.interval,
          day: meeting.recurrenceRule.byDay,
          until: meeting.recurrenceRule.until?.toISOString(),
        };
      }

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Invalid request data',
          details: error.errors,
        });
        return;
      }

      logger.error('Error in createBooking controller', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'An error occurred while creating the booking',
      });
    }
  };
}
