import { RecurrenceService } from '../../domain/services/RecurrenceService';
import {
  MeetingWithRecurrence,
  RecurrenceFrequency,
  ExceptionType,
} from '../../domain/models/Meeting';
import { describe } from 'node:test';

describe('RecurrenceService', () => {
  let recurrenceService: RecurrenceService;

  beforeAll(() => {
    recurrenceService = RecurrenceService.getInstance();
  });

  describe('expandRecurringMeeting', () => {
    it('should return single occurrence for non-recurring meeting', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-1',
        resourceId: 'R123',
        startTime: new Date('2025-01-10T09:00:00Z'),
        endTime: new Date('2025-01-10T10:00:00Z'),
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].startTime).toEqual(meeting.startTime);
      expect(occurrences[0].endTime).toEqual(meeting.endTime);
    });

    it('should expand weekly recurring meeting correctly', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-2',
        resourceId: 'R123',
        startTime: new Date('2025-01-06T09:00:00Z'), // Monday
        endTime: new Date('2025-01-06T10:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          byDay: [0], // Monday
          until: new Date('2025-01-27T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have 4 Mondays in January: 6, 13, 20, 27
      expect(occurrences.length).toEqual(4);
      
      // Verify each occurrence is 1 hour long
      occurrences.forEach((occurrence) => {
        const duration = occurrence.endTime.getTime() - occurrence.startTime.getTime();
        expect(duration).toBe(60 * 60 * 1000); // 1 hour
      });
    });

    it('should handle SKIP exceptions correctly', () => {
      const skipDate = new Date('2025-01-12T09:00:00Z');
      
      const meeting: MeetingWithRecurrence = {
        id: 'test-3',
        resourceId: 'R123',
        startTime: new Date('2025-01-06T09:00:00Z'),
        endTime: new Date('2025-01-06T10:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          byDay: [6], // Sunday
          until: new Date('2025-01-27T23:59:59Z'),
        },
        exceptions: [
          {
            exceptionType: ExceptionType.SKIP,
            exceptionDate: skipDate,
          },
        ],
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should not include the skipped date
      expect(occurrences.length).toEqual(2);
      const hasSkippedDate = occurrences.some(
        (occ) => occ.startTime.getTime() === skipDate.getTime()
      );
      expect(hasSkippedDate).toBe(false);
    });

    it('should handle CANCEL exceptions correctly', () => {
      const cancelDate = new Date('2025-01-20T09:00:00Z');
      
      const meeting: MeetingWithRecurrence = {
        id: 'test-4',
        resourceId: 'R123',
        startTime: new Date('2025-01-06T09:00:00Z'),
        endTime: new Date('2025-01-06T10:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          byDay: [0], // Monday
          until: new Date('2025-01-27T23:59:59Z'),
        },
        exceptions: [
          {
            exceptionType: ExceptionType.CANCEL,
            exceptionDate: cancelDate,
          },
        ],
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should not include the cancelled date
      expect(occurrences.length).toEqual(3);
      const hasCancelledDate = occurrences.some(
        (occ) => occ.startTime.getTime() === cancelDate.getTime()
      );
      expect(hasCancelledDate).toBe(false);
    });
  });

  describe('getOccurrencesForNext30Days', () => {
    it('should return occurrences for next 30 days', () => {
      const now = new Date();
      const meeting: MeetingWithRecurrence = {
        id: 'test-5',
        resourceId: 'R123',
        startTime: now,
        endTime: new Date(now.getTime() + 60 * 60 * 1000),
        recurrenceRule: {
          frequency: RecurrenceFrequency.DAILY,
          interval: 1,
          byDay: [],
        },
      };

      const occurrences = recurrenceService.getOccurrencesForNext30Days(meeting);

      // Should have approximately 30 occurrences (one per day)
      expect(occurrences.length).toBeGreaterThanOrEqual(28);
      expect(occurrences.length).toBeLessThanOrEqual(31);
    });
  });

  describe('Monthly Recurring Meetings', () => {
    it('should expand monthly recurring meeting correctly', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-monthly-1',
        resourceId: 'R123',
        startTime: new Date('2025-01-15T14:00:00Z'),
        endTime: new Date('2025-01-15T15:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 1,
          byDay: [],
          until: new Date('2025-06-30T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-06-30T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have 6 monthly occurrences (Jan through Jun)
      expect(occurrences.length).toBe(6);
      
      // Verify each occurrence maintains duration
      occurrences.forEach((occurrence) => {
        const duration = occurrence.endTime.getTime() - occurrence.startTime.getTime();
        expect(duration).toBe(60 * 60 * 1000); // 1 hour
      });
    });

    it('should handle monthly recurring meeting with interval', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-monthly-2',
        resourceId: 'R123',
        startTime: new Date('2025-01-15T14:00:00Z'),
        endTime: new Date('2025-01-15T15:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 2, // Every 2 months
          byDay: [],
          until: new Date('2025-12-31T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-12-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have 6 occurrences (Jan, Mar, May, Jul, Sep, Nov)
      expect(occurrences.length).toBe(6);
    });
  });

  describe('Daily Recurring Meetings', () => {
    it('should expand daily recurring meeting correctly', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-daily-1',
        resourceId: 'R456',
        startTime: new Date('2025-01-01T09:00:00Z'),
        endTime: new Date('2025-01-01T10:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.DAILY,
          interval: 1,
          byDay: [],
          until: new Date('2025-01-14T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-14T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have 14 daily occurrences
      expect(occurrences.length).toBe(14);
      
      // Verify consecutive days
      for (let i = 1; i < occurrences.length; i++) {
        const dayDiff = (occurrences[i].startTime.getTime() - 
                        occurrences[i - 1].startTime.getTime()) / (1000 * 60 * 60 * 24);
        expect(dayDiff).toBe(1);
      }
    });

    it('should handle daily recurring meeting with interval', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-daily-2',
        resourceId: 'R456',
        startTime: new Date('2025-01-01T09:00:00Z'),
        endTime: new Date('2025-01-01T10:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.DAILY,
          interval: 3, // Every 3 days
          byDay: [],
          until: new Date('2025-01-31T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2025-01-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have approximately 10-11 occurrences (every 3 days in 31 days)
      expect(occurrences.length).toBeGreaterThanOrEqual(10);
      expect(occurrences.length).toBeLessThanOrEqual(11);
    });
  });

  describe('Yearly Recurring Meetings', () => {
    it('should expand yearly recurring meeting correctly', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-yearly-1',
        resourceId: 'R789',
        startTime: new Date('2025-03-15T10:00:00Z'),
        endTime: new Date('2025-03-15T11:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.YEARLY,
          interval: 1,
          byDay: [],
          until: new Date('2030-12-31T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2030-12-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have 6 yearly occurrences (2025-2030)
      expect(occurrences.length).toBe(6);
      
      // Verify each occurrence is on March 15
      occurrences.forEach((occurrence) => {
        expect(occurrence.startTime.getMonth()).toBe(2); // March (0-indexed)
        expect(occurrence.startTime.getDate()).toBe(15);
      });
    });

    it('should handle yearly recurring meeting with interval', () => {
      const meeting: MeetingWithRecurrence = {
        id: 'test-yearly-2',
        resourceId: 'R789',
        startTime: new Date('2025-06-01T14:00:00Z'),
        endTime: new Date('2025-06-01T15:00:00Z'),
        recurrenceRule: {
          frequency: RecurrenceFrequency.YEARLY,
          interval: 2, // Every 2 years
          byDay: [],
          until: new Date('2035-12-31T23:59:59Z'),
        },
      };

      const rangeStart = new Date('2025-01-01T00:00:00Z');
      const rangeEnd = new Date('2035-12-31T23:59:59Z');

      const occurrences = recurrenceService.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      // Should have 6 occurrences (2025, 2027, 2029, 2031, 2033, 2035)
      expect(occurrences.length).toBe(6);
    });
  });

  describe('Fetching Meetings for Specific Days', () => {
    it('should fetch all meetings for next 30 days on server start', () => {
      const now = new Date();
      const meetings: MeetingWithRecurrence[] = [
        {
          id: 'daily-meeting',
          resourceId: 'R111',
          startTime: now,
          endTime: new Date(now.getTime() + 60 * 60 * 1000),
          recurrenceRule: {
            frequency: RecurrenceFrequency.DAILY,
            interval: 1,
            byDay: [],
          },
        },
        {
          id: 'weekly-meeting',
          resourceId: 'R222',
          startTime: now,
          endTime: new Date(now.getTime() + 60 * 60 * 1000),
          recurrenceRule: {
            frequency: RecurrenceFrequency.WEEKLY,
            interval: 1,
            byDay: [now.getDay()],
          },
        },
        {
          id: 'one-time-meeting',
          resourceId: 'R333',
          startTime: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
          endTime: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        },
      ];

      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const allOccurrences = recurrenceService.getAllOccurrencesInRange(
        meetings,
        now,
        end
      );

      // Should have occurrences for all 3 resources
      expect(allOccurrences.size).toBe(3);
      
      // Daily meeting should have ~30 occurrences
      const dailyOccurrences = allOccurrences.get('R111') || [];
      expect(dailyOccurrences.length).toBeGreaterThanOrEqual(28);
      expect(dailyOccurrences.length).toBeLessThanOrEqual(31);
      
      // Weekly meeting should have ~4 occurrences
      const weeklyOccurrences = allOccurrences.get('R222') || [];
      expect(weeklyOccurrences.length).toBeGreaterThanOrEqual(3);
      expect(weeklyOccurrences.length).toBeLessThanOrEqual(5);
      
      // One-time meeting should have 1 occurrence
      const oneTimeOccurrences = allOccurrences.get('R333') || [];
      expect(oneTimeOccurrences.length).toBe(1);
    });

    it('should fetch meetings for the 30th day from today', () => {
      const today = new Date();
      const day30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const meeting: MeetingWithRecurrence = {
        id: 'test-day30',
        resourceId: 'R123',
        startTime: new Date(day30.getFullYear(), day30.getMonth(), day30.getDate(), 10, 0, 0),
        endTime: new Date(day30.getFullYear(), day30.getMonth(), day30.getDate(), 11, 0, 0),
        recurrenceRule: {
          frequency: RecurrenceFrequency.DAILY,
          interval: 1,
          byDay: [],
        },
      };

      const occurrences = recurrenceService.getOccurrencesForSpecificDay(meeting, day30);

      // Should have exactly 1 occurrence on the 30th day
      expect(occurrences.length).toBe(1);
      expect(occurrences[0].startTime.getDate()).toBe(day30.getDate());
      expect(occurrences[0].startTime.getMonth()).toBe(day30.getMonth());
      expect(occurrences[0].startTime.getFullYear()).toBe(day30.getFullYear());
    });

    it('should handle multiple meetings on the 30th day', () => {
      const today = new Date();
      const day30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const meeting: MeetingWithRecurrence = {
        id: 'test-multiple-day30',
        resourceId: 'R456',
        startTime: new Date(day30.getFullYear(), day30.getMonth(), day30.getDate(), 9, 0, 0),
        endTime: new Date(day30.getFullYear(), day30.getMonth(), day30.getDate(), 10, 0, 0),
        recurrenceRule: {
          frequency: RecurrenceFrequency.DAILY,
          interval: 1,
          byDay: [],
        },
      };

      // This should work for a weekly recurring meeting that happens to fall on day 30
      const occurrences = recurrenceService.getOccurrencesForSpecificDay(meeting, day30);
      
      expect(occurrences.length).toBeGreaterThanOrEqual(1);
      occurrences.forEach((occurrence) => {
        expect(occurrence.startTime.getDate()).toBe(day30.getDate());
      });
    });
  });
});
