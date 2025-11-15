import { MeetingRepository } from '../../infrastructure/repositories/MeetingRepository';
import { RecurrenceService } from '../../domain/services/RecurrenceService';
import { CacheService } from './CacheService';
import { Meeting, TimeSlot } from '../../domain/models/Meeting';
import { logger } from '../../infrastructure/logging/Logger';
import { startOfDay, endOfDay, addMinutes, isBefore, isAfter } from 'date-fns';
import { BookingService } from './BookingService';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface AvailabilityResult {
  availability: TimeSlot[];
  total: number;
  page: number;
  limit: number;
}

export class AvailabilityService {
  private static instance: AvailabilityService;
  private meetingRepository: MeetingRepository;
  private recurrenceService: RecurrenceService;
  private cacheService: CacheService;

  private constructor() {
    this.meetingRepository = MeetingRepository.getInstance();
    this.recurrenceService = RecurrenceService.getInstance();
    this.cacheService = CacheService.getInstance();
  }

  public static getInstance(): AvailabilityService {
    if (!AvailabilityService.instance) {
      AvailabilityService.instance = new AvailabilityService();
    }
    return AvailabilityService.instance;
  }

  public async getAvailability(
    resourceId: string,
    startTime: Date,
    endTime: Date,
    page: number = 1,
    limit: number = 20
  ): Promise<AvailabilityResult> {
    try {
      // Try to get from cache first
      const redisAvailable = await this.cacheService.isRedisAvailable();
      let bookedSlots: TimeSlot[] = [];

      const now = new Date();
      const isWithin30Days =startTime.getTime() - now.getTime() <= THIRTY_DAYS_MS &&
                          endTime.getTime() - now.getTime() <= THIRTY_DAYS_MS;

      if (redisAvailable && isWithin30Days) {
        // Get from cache
        bookedSlots = await this.cacheService.getMeetingsForDateRange(
          resourceId,
          startTime,
          endTime
        );
        logger.debug('Retrieved meetings from cache', {
          resourceId,
          count: bookedSlots.length,
        });
      } else {
        // Fallback to database
        logger.warn('Redis unavailable, falling back to database');
        bookedSlots = await this.getAllMeetingsForResourceByDateRange(
          resourceId,
          startTime,
          endTime
        );
      }

      // Calculate available slots
      const availableSlots = this.calculateAvailableSlots(
        startTime,
        endTime,
        bookedSlots
      );

      // Apply pagination
      const total = availableSlots.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedSlots = availableSlots.slice(startIndex, endIndex);

      return {
        availability: paginatedSlots,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Error getting availability', { resourceId, error });
      throw error;
    }
  }

  public async getAllMeetingsForResourceByDateRange(
    resourceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<Meeting[]> {
    const meetings = await this.meetingRepository.findMeetingsByResourceAndDateRange(
      resourceId,
      startTime,
      endTime
    );

    const allSlots: Meeting[] = [];

    for (const meeting of meetings) {
      const occurrences = this.recurrenceService.expandRecurringMeeting(
        meeting,
        startTime,
        endTime
      );
      allSlots.push(...occurrences);
    }

    // Sort by start time
    allSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return allSlots;
  }

  private calculateAvailableSlots(
    rangeStart: Date,
    rangeEnd: Date,
    bookedSlots: TimeSlot[],
    slotDuration: number = 60 * 60 * 1000 // 1 hour in milliseconds
  ): TimeSlot[] {
    const availableSlots: TimeSlot[] = [];

    // Define working hours (9 AM to 6 PM)
    const workStartHour = 9;
    const workEndHour = 18;

    let currentDay = startOfDay(rangeStart);
    const endDay = endOfDay(rangeEnd);

    while (currentDay <= endDay) {
      // Set working hours for the current day
      const dayStart = new Date(currentDay);
      dayStart.setHours(workStartHour, 0, 0, 0);

      const dayEnd = new Date(currentDay);
      dayEnd.setHours(workEndHour, 0, 0, 0);

      // Adjust if the range starts later in the day
      let slotStart = dayStart < rangeStart ? rangeStart : dayStart;
      const slotEndLimit = dayEnd > rangeEnd ? rangeEnd : dayEnd;

      // Get booked slots for this day
      const dayBookedSlots = bookedSlots.filter(
        (slot) =>
          startOfDay(slot.startTime).getTime() === currentDay.getTime()
      );

      // Sort booked slots
      dayBookedSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      // Find gaps between booked slots
      for (const bookedSlot of dayBookedSlots) {
        // Check if there's a gap before this booked slot
        while (slotStart < bookedSlot.startTime && slotStart < slotEndLimit) {
          const potentialSlotEnd = new Date(slotStart.getTime() + slotDuration);

          if (potentialSlotEnd <= bookedSlot.startTime && potentialSlotEnd <= slotEndLimit) {
            availableSlots.push({
              startTime: new Date(slotStart),
              endTime: new Date(potentialSlotEnd),
            });
            slotStart = potentialSlotEnd;
          } else if (slotStart < bookedSlot.startTime) {
            // Partial slot available
            const adjustedEnd = bookedSlot.startTime < slotEndLimit 
              ? bookedSlot.startTime 
              : slotEndLimit;
            
            if (slotStart < adjustedEnd) {
              availableSlots.push({
                startTime: new Date(slotStart),
                endTime: new Date(adjustedEnd),
              });
            }
            slotStart = bookedSlot.endTime;
            break;
          } else {
            break;
          }
        }

        // Move past the booked slot
        if (bookedSlot.endTime > slotStart) {
          slotStart = bookedSlot.endTime;
        }
      }

      // Check for availability after the last booked slot
      while (slotStart < slotEndLimit) {
        const potentialSlotEnd = new Date(slotStart.getTime() + slotDuration);

        if (potentialSlotEnd <= slotEndLimit) {
          availableSlots.push({
            startTime: new Date(slotStart),
            endTime: new Date(potentialSlotEnd),
          });
          slotStart = potentialSlotEnd;
        } else if (slotStart < slotEndLimit) {
          // Add remaining time as a slot
          availableSlots.push({
            startTime: new Date(slotStart),
            endTime: new Date(slotEndLimit),
          });
          break;
        } else {
          break;
        }
      }

      // Move to next day
      currentDay = new Date(currentDay);
      currentDay.setDate(currentDay.getDate() + 1);
    }

    return availableSlots;
  }
}
