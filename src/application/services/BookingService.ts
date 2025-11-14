import { DatabaseClient } from '../../infrastructure/database/DatabaseClient';
import { MeetingRepository } from '../../infrastructure/repositories/MeetingRepository';
import { RedisLockManager } from '../../infrastructure/cache/RedisLockManager';
import { KafkaProducer } from '../../infrastructure/messaging/KafkaProducer';
import { RecurrenceService } from '../../domain/services/RecurrenceService';
import { CacheService } from './CacheService';
import {
  MeetingWithRecurrence,
  RecurrenceRule,
  RecurrenceException,
  ExceptionType,
  ConflictingMeeting,
  TimeSlot,
} from '../../domain/models/Meeting';
import { logger } from '../../infrastructure/logging/Logger';
import { addMinutes } from 'date-fns';

export interface BookingConflict {
  conflictingMeetings: ConflictingMeeting[];
  nextAvailable: TimeSlot[];
}

export class BookingService {
  private static instance: BookingService;
  private db: DatabaseClient;
  private meetingRepository: MeetingRepository;
  private lockManager: RedisLockManager;
  private kafkaProducer: KafkaProducer;
  private recurrenceService: RecurrenceService;
  private cacheService: CacheService;

  private constructor() {
    this.db = DatabaseClient.getInstance();
    this.meetingRepository = MeetingRepository.getInstance();
    this.lockManager = RedisLockManager.getInstance();
    this.kafkaProducer = KafkaProducer.getInstance();
    this.recurrenceService = RecurrenceService.getInstance();
    this.cacheService = CacheService.getInstance();
  }

  public static getInstance(): BookingService {
    if (!BookingService.instance) {
      BookingService.instance = new BookingService();
    }
    return BookingService.instance;
  }

  public async createBooking(
    resourceId: string,
    startTime: Date,
    endTime: Date,
    recurrenceRule?: RecurrenceRule,
    exceptions?: RecurrenceException[]
  ): Promise<MeetingWithRecurrence | BookingConflict> {
    // Use distributed lock to prevent double booking
    return await this.lockManager.withLock(resourceId, async () => {
      return await this.db.transaction(async (client) => {
        // Check for conflicts
        const conflicts = await this.detectConflicts(
          resourceId,
          startTime,
          endTime,
          recurrenceRule,
          exceptions
        );

        if (conflicts.conflictingMeetings.length > 0) {
          logger.info('Booking conflict detected', {
            resourceId,
            conflicts: conflicts.conflictingMeetings.length,
          });
          return conflicts;
        }

        // No conflicts, create the meeting
        const meeting = await this.meetingRepository.createMeeting(
          { resourceId, startTime, endTime },
          recurrenceRule,
          exceptions,
          client
        );

        logger.info('Meeting created successfully', {
          meetingId: meeting.id,
          resourceId,
        });

        // Publish to Kafka for cache update
        try {
          await this.kafkaProducer.publishBookingEvent(meeting);
        } catch (error) {
          logger.error('Failed to publish booking event to Kafka', error);
          // Don't fail the booking if Kafka publish fails
        }

        return meeting;
      });
    });
  }

  private async detectConflicts(
    resourceId: string,
    startTime: Date,
    endTime: Date,
    recurrenceRule?: RecurrenceRule,
    exceptions?: RecurrenceException[]
  ): Promise<BookingConflict> {
    const conflictingMeetings: ConflictingMeeting[] = [];

    if (!recurrenceRule) {
      // Simple single meeting - check database directly
      const conflicts = await this.meetingRepository.findConflictingMeetings(
        resourceId,
        startTime,
        endTime
      );

      if (conflicts.length > 0) {
        return {
          conflictingMeetings: conflicts.map((m) => ({
            meetingId: m.id,
            startTime: m.startTime,
            endTime: m.endTime,
          })),
          nextAvailable: await this.findNextAvailableSlots(
            resourceId,
            startTime,
            endTime
          ),
        };
      }

      return { conflictingMeetings: [], nextAvailable: [] };
    }

    // Recurring meeting - expand and check each occurrence
    const proposedMeeting: MeetingWithRecurrence = {
      id: 'temp',
      resourceId,
      startTime,
      endTime,
      recurrenceRule,
      exceptions,
    };

    // Check for next 30 days (or until recurrence ends)
    const checkUntil = recurrenceRule.until || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const occurrences = this.recurrenceService.expandRecurringMeeting(
      proposedMeeting,
      startTime,
      checkUntil
    );

    // Check each occurrence for conflicts
    for (const occurrence of occurrences) {
      const conflicts = await this.meetingRepository.findConflictingMeetings(
        resourceId,
        occurrence.startTime,
        occurrence.endTime
      );

      if (conflicts.length > 0) {
        conflictingMeetings.push(
          ...conflicts.map((m) => ({
            meetingId: m.id,
            startTime: m.startTime,
            endTime: m.endTime,
          }))
        );
      }
    }

    if (conflictingMeetings.length > 0) {
      return {
        conflictingMeetings,
        nextAvailable: await this.findNextAvailableSlots(
          resourceId,
          startTime,
          endTime
        ),
      };
    }

    return { conflictingMeetings: [], nextAvailable: [] };
  }

  private async findNextAvailableSlots(
    resourceId: string,
    requestedStart: Date,
    requestedEnd: Date,
    limit: number = 5
  ): Promise<TimeSlot[]> {
    const duration = requestedEnd.getTime() - requestedStart.getTime();
    const availableSlots: TimeSlot[] = [];

    // Search forward from the requested start time
    let currentStart = new Date(requestedStart);
    const searchLimit = new Date(requestedStart.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    while (availableSlots.length < limit && currentStart < searchLimit) {
      const currentEnd = new Date(currentStart.getTime() + duration);

      const conflicts = await this.meetingRepository.findConflictingMeetings(
        resourceId,
        currentStart,
        currentEnd
      );

      if (conflicts.length === 0) {
        availableSlots.push({
          startTime: new Date(currentStart),
          endTime: new Date(currentEnd),
        });
        // Move forward by the duration to find the next slot
        currentStart = new Date(currentEnd.getTime() + 15 * 60 * 1000); // 15 min gap
      } else {
        // Move to after the conflicting meeting
        const latestConflictEnd = Math.max(
          ...conflicts.map((m) => m.endTime.getTime())
        );
        currentStart = new Date(latestConflictEnd + 15 * 60 * 1000); // 15 min gap
      }
    }

    return availableSlots;
  }
}
