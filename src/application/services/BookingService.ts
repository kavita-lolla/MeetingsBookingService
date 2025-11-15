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
  Meeting,
} from '../../domain/models/Meeting';
import { logger } from '../../infrastructure/logging/Logger';
import { addMinutes } from 'date-fns';
import { AvailabilityService } from './AvailabilityService';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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
  private availabilityService: AvailabilityService;

  private constructor() {
    this.db = DatabaseClient.getInstance();
    this.meetingRepository = MeetingRepository.getInstance();
    this.lockManager = RedisLockManager.getInstance();
    this.kafkaProducer = KafkaProducer.getInstance();
    this.recurrenceService = RecurrenceService.getInstance();
    this.cacheService = CacheService.getInstance();
    this.availabilityService = AvailabilityService.getInstance();
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

        // Use distributed lock to prevent double booking
    return await this.lockManager.withLock(resourceId, async () => {
      return await this.db.transaction(async (client) => {
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

    if (!recurrenceRule) {
      return await this.detectConflictingMeetings(resourceId, startTime, endTime);
    }
    else {
      return await this.detectConflictingRecurringMeetings(resourceId, startTime, endTime, recurrenceRule, exceptions);
    }
  }

  private async detectConflictingRecurringMeetings(
    resourceId: string,
    startTime: Date,
    endTime: Date,
    recurrenceRule: RecurrenceRule,
    exceptions?: RecurrenceException[]
  ): Promise<BookingConflict> {
    const proposedMeeting: MeetingWithRecurrence = {
      id: 'temp',
      resourceId,
      startTime,
      endTime,
      recurrenceRule,
      exceptions,
    };

    const conflictingMeetings: ConflictingMeeting[] = [];
    const redisAvailable = await this.cacheService.isRedisAvailable();
    const now = new Date();
    const isWithin30Days =startTime.getTime() - now.getTime() <= THIRTY_DAYS_MS &&
                          endTime.getTime() - now.getTime() <= THIRTY_DAYS_MS;
    const meetings:Meeting[] = [];
    // Check for next 30 days (or until recurrence ends)
    const checkUntil = new Date(Math.min((recurrenceRule.until?.getTime() ?? Infinity) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).getTime()));

    if (redisAvailable && isWithin30Days) {
      meetings.push(...await this.cacheService.getMeetingsForDateRange(resourceId, startTime, endTime));
    }
  else {
    meetings.push(... await this.availabilityService.getAllMeetingsForResourceByDateRange(resourceId, startTime, checkUntil));
  }

    const occurrences = this.recurrenceService.expandRecurringMeeting(
      proposedMeeting,
      startTime,
      checkUntil
    );

    const availability : TimeSlot[] = [];
    // Check each occurrence for conflicts
    for (const occurrence of occurrences) {
      availability.push(... this.findNextAvailableSlots(occurrence.startTime, occurrence.endTime, meetings, 1));
      for (const meeting of meetings) {
        if (this.timeOverlaps(meeting.startTime, meeting.endTime, startTime, endTime)) {
          conflictingMeetings.push({
            meetingId: meeting.id,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
          });
        }
      }
    }

    const frequencyOfSlots = this.getSlotFrequency(availability, occurrences.length);

    availability.filter(availability => {
      const key = `${availability.startTime}|${availability.endTime}`;
      return frequencyOfSlots.get(key) === occurrences.length;
    });

    return {conflictingMeetings, nextAvailable: availability};
  }

  private async detectConflictingMeetings(
    resourceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<BookingConflict> {
    const conflictingMeetings: ConflictingMeeting[] = [];
    const redisAvailable = await this.cacheService.isRedisAvailable();
    const now = new Date();
    const isWithin30Days =startTime.getTime() - now.getTime() <= THIRTY_DAYS_MS &&
                          endTime.getTime() - now.getTime() <= THIRTY_DAYS_MS;
    const conflicts:Meeting[] = [];
    const meetings:Meeting[] = [];

    if (redisAvailable && isWithin30Days) {
        meetings.push(...await this.cacheService.getMeetingsForDateRange(resourceId, startTime, endTime));
      }
    else {
      meetings.push(... await this.availabilityService.getAllMeetingsForResourceByDateRange(resourceId, startTime, endTime));
    }
    
    for (const meeting of meetings) {
      if (this.timeOverlaps(meeting.startTime, meeting.endTime, startTime, endTime)) {
        conflicts.push(meeting);
      }
    }

    if (conflicts.length > 0) {
      conflictingMeetings.push(
        ...conflicts.map((m) => ({
          meetingId: m.id,
          startTime: m.startTime,
          endTime: m.endTime,
        }))
      )
      return {
        conflictingMeetings,
        nextAvailable: await this.findNextAvailableSlots(
          startTime,
          endTime,
          meetings,
          7
        ),
      };
    }

    return { conflictingMeetings: [], nextAvailable: [] };
  }

  private getSlotFrequency(allAvailableSlots: TimeSlot[], repeatCount: Number) {
    const frequency = new Map();

    for (const item of allAvailableSlots) {
      const key = `${item.startTime}|${item.endTime}`;
      frequency.set(key, (frequency.get(key) || 0) + 1);
    }

    return frequency;
  }

  private timeOverlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
    return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
  }
  
  private findNextAvailableSlots(
    requestedStart: Date,
    requestedEnd: Date,
    meetings: Meeting[],
    checkInDays: number,
    limit: number = 5
  ): TimeSlot[] {
    meetings.sort((a,b) => a.startTime.getTime() - b.startTime.getTime() );
    
    const duration = requestedEnd.getTime() - requestedStart.getTime();
    const availableSlots: TimeSlot[] = [];

    // Search forward from the requested start time
    let currentStart = new Date(requestedStart);
    const searchLimit = new Date(requestedStart.getTime() + checkInDays * 24 * 60 * 60 * 1000);

    for (const meeting of meetings) {
      while (availableSlots.length < limit && currentStart < searchLimit) {
        if(meeting.endTime > requestedStart&& meeting.startTime < requestedEnd)
          continue;
        if (meeting.startTime > currentStart) {
          availableSlots.push({
            startTime: new Date(currentStart),
            endTime: new Date(Math.min(meeting.startTime.getTime(), addMinutes(currentStart, duration).getTime()))
          });
        }
    
        // Move the current pointer forward if event overlaps or touches it
        if (meeting.endTime > currentStart) {
          currentStart = new Date(meeting.endTime);
        }
      }
    }
    // while (availableSlots.length < limit && currentStart < searchLimit) {
    //   const currentEnd = new Date(currentStart.getTime() + duration);

    //   if (conflicts.length === 0) {
    //     availableSlots.push({
    //       startTime: new Date(currentStart),
    //       endTime: new Date(currentEnd),
    //     });
    //     // Move forward by the duration to find the next slot
    //     currentStart = new Date(currentEnd.getTime() + 15 * 60 * 1000); // 15 min gap
    //   } else {
    //     // Move to after the conflicting meeting
    //     const latestConflictEnd = Math.max(
    //       ...conflicts.map((m) => m.endTime.getTime())
    //     );
    //     currentStart = new Date(latestConflictEnd + 15 * 60 * 1000); // 15 min gap
    //   }
    // }

    return availableSlots;
  }
}
