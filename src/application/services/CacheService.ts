import { RedisClient } from '../../infrastructure/cache/RedisClient';
import { MeetingRepository } from '../../infrastructure/repositories/MeetingRepository';
import { RecurrenceService } from '../../domain/services/RecurrenceService';
import { MeetingWithRecurrence, TimeSlot } from '../../domain/models/Meeting';
import { logger } from '../../infrastructure/logging/Logger';
import { config } from '../../config';
import { addDays, startOfDay, endOfDay, format } from 'date-fns';

export class CacheService {
  private static instance: CacheService;
  private redisClient: RedisClient;
  private meetingRepository: MeetingRepository;
  private recurrenceService: RecurrenceService;

  private constructor() {
    this.redisClient = RedisClient.getInstance();
    this.meetingRepository = MeetingRepository.getInstance();
    this.recurrenceService = RecurrenceService.getInstance();
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private getCacheKey(resourceId: string, date: Date): string {
    const dateStr = format(date, 'yyyy-MM-dd');
    return `meetings:${resourceId}:${dateStr}`;
  }

  public async populateCache(): Promise<void> {
    try {
      logger.info('Starting cache population');

      const now = new Date();
      const endDate = addDays(now, config.cache.precomputeDays);

      // Fetch all meetings with recurrence rules
      const allMeetings = await this.meetingRepository.findAllMeetingsWithRecurrence();

      // Expand recurring meetings for the next 30 days
      const meetingsByDay = new Map<string, Map<string, TimeSlot[]>>();

      for (const meeting of allMeetings) {
        const occurrences = this.recurrenceService.expandRecurringMeeting(
          meeting,
          now,
          endDate
        );

        for (const occurrence of occurrences) {
          const dayStart = startOfDay(occurrence.startTime);
          const dayKey = dayStart.toISOString();

          if (!meetingsByDay.has(dayKey)) {
            meetingsByDay.set(dayKey, new Map());
          }

          const resourceMap = meetingsByDay.get(dayKey)!;
          if (!resourceMap.has(meeting.resourceId)) {
            resourceMap.set(meeting.resourceId, []);
          }

          resourceMap.get(meeting.resourceId)!.push({
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
          });
        }
      }

      // Store in Redis
      for (const [dayKey, resourceMap] of meetingsByDay) {
        const day = new Date(dayKey);
        const endOfDayTime = Math.floor(endOfDay(day).getTime() / 1000);

        for (const [resourceId, slots] of resourceMap) {
          const cacheKey = this.getCacheKey(resourceId, day);
          const value = JSON.stringify(slots);

          await this.redisClient.set(cacheKey, value);
          await this.redisClient.expireAt(cacheKey, endOfDayTime);

          logger.debug('Cached meetings for day', {
            resourceId,
            date: format(day, 'yyyy-MM-dd'),
            count: slots.length,
          });
        }
      }

      logger.info('Cache population completed', {
        totalDays: meetingsByDay.size,
      });
    } catch (error) {
      logger.error('Error populating cache', error);
      throw error;
    }
  }

  public async addMeetingToCache(
    meeting: MeetingWithRecurrence
  ): Promise<void> {
    try {
      const now = new Date();
      const endDate = addDays(now, config.cache.precomputeDays);

      const occurrences = this.recurrenceService.expandRecurringMeeting(
        meeting,
        now,
        endDate
      );

      for (const occurrence of occurrences) {
        const day = startOfDay(occurrence.startTime);
        const cacheKey = this.getCacheKey(meeting.resourceId, day);

        // Get existing meetings for this day
        const existing = await this.redisClient.get(cacheKey);
        const slots: TimeSlot[] = existing ? JSON.parse(existing) : [];

        // Add new meeting
        slots.push({
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
        });

        // Sort by start time
        slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        // Save back to cache
        const value = JSON.stringify(slots);
        const endOfDayTime = Math.floor(endOfDay(day).getTime() / 1000);

        await this.redisClient.set(cacheKey, value);
        await this.redisClient.expireAt(cacheKey, endOfDayTime);

        logger.debug('Added meeting to cache', {
          resourceId: meeting.resourceId,
          date: format(day, 'yyyy-MM-dd'),
          meetingId: meeting.id,
        });
      }
    } catch (error) {
      logger.error('Error adding meeting to cache', { meeting, error });
    }
  }

  public async getMeetingsForDay(
    resourceId: string,
    date: Date
  ): Promise<TimeSlot[]> {
    try {
      const day = startOfDay(date);
      const cacheKey = this.getCacheKey(resourceId, day);

      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        const slots: TimeSlot[] = JSON.parse(cached);
        // Parse dates back from JSON
        return slots.map((slot) => ({
          startTime: new Date(slot.startTime),
          endTime: new Date(slot.endTime),
        }));
      }

      return [];
    } catch (error) {
      logger.error('Error getting meetings from cache', { resourceId, date, error });
      return [];
    }
  }

  public async getMeetingsForDateRange(
    resourceId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TimeSlot[]> {
    try {
      const allSlots: TimeSlot[] = [];
      let currentDay = startOfDay(startDate);
      const end = startOfDay(endDate);

      while (currentDay <= end) {
        const daySlots = await this.getMeetingsForDay(resourceId, currentDay);
        allSlots.push(...daySlots);
        currentDay = addDays(currentDay, 1);
      }

      return allSlots;
    } catch (error) {
      logger.error('Error getting meetings for date range from cache', {
        resourceId,
        startDate,
        endDate,
        error,
      });
      return [];
    }
  }

  public async populateCacheFor30thDay(): Promise<void> {
    try {
      logger.info('Populating cache for 30th day');

      const targetDay = addDays(new Date(), 30);
      const dayStart = startOfDay(targetDay);
      const dayEnd = endOfDay(targetDay);

      // Fetch all meetings with recurrence rules
      const allMeetings = await this.meetingRepository.findAllMeetingsWithRecurrence();

      const meetingsByResource = new Map<string, TimeSlot[]>();

      for (const meeting of allMeetings) {
        const occurrences = this.recurrenceService.expandRecurringMeeting(
          meeting,
          dayStart,
          dayEnd
        );

        if (occurrences.length > 0) {
          if (!meetingsByResource.has(meeting.resourceId)) {
            meetingsByResource.set(meeting.resourceId, []);
          }
          meetingsByResource.get(meeting.resourceId)!.push(...occurrences);
        }
      }

      // Store in Redis
      const endOfDayTime = Math.floor(endOfDay(targetDay).getTime() / 1000);

      for (const [resourceId, slots] of meetingsByResource) {
        const cacheKey = this.getCacheKey(resourceId, targetDay);
        const value = JSON.stringify(slots);

        await this.redisClient.set(cacheKey, value);
        await this.redisClient.expireAt(cacheKey, endOfDayTime);

        logger.debug('Cached meetings for 30th day', {
          resourceId,
          date: format(targetDay, 'yyyy-MM-dd'),
          count: slots.length,
        });
      }

      logger.info('30th day cache population completed', {
        resourceCount: meetingsByResource.size,
      });
    } catch (error) {
      logger.error('Error populating cache for 30th day', error);
    }
  }

  public async isRedisAvailable(): Promise<boolean> {
    return await this.redisClient.healthCheck();
  }
}
