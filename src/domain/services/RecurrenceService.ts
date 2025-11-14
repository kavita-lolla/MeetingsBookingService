import { RRule, Frequency } from 'rrule';
import {
  MeetingWithRecurrence,
  RecurrenceFrequency,
  ExceptionType,
  TimeSlot,
} from '../models/Meeting';
import { startOfDay, endOfDay, addDays, isWithinInterval } from 'date-fns';

export class RecurrenceService {
  private static instance: RecurrenceService;

  private constructor() {}

  public static getInstance(): RecurrenceService {
    if (!RecurrenceService.instance) {
      RecurrenceService.instance = new RecurrenceService();
    }
    return RecurrenceService.instance;
  }

  private mapFrequency(frequency: RecurrenceFrequency): Frequency {
    const frequencyMap: Record<RecurrenceFrequency, Frequency> = {
      [RecurrenceFrequency.DAILY]: RRule.DAILY,
      [RecurrenceFrequency.WEEKLY]: RRule.WEEKLY,
      [RecurrenceFrequency.MONTHLY]: RRule.MONTHLY,
      [RecurrenceFrequency.YEARLY]: RRule.YEARLY,
    };
    return frequencyMap[frequency];
  }

  public expandRecurringMeeting(
    meeting: MeetingWithRecurrence,
    rangeStart: Date,
    rangeEnd: Date
  ): TimeSlot[] {
    if (!meeting.recurrenceRule) {
      // Non-recurring meeting
      if (
        isWithinInterval(meeting.startTime, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(meeting.endTime, { start: rangeStart, end: rangeEnd }) ||
        (meeting.startTime <= rangeStart && meeting.endTime >= rangeEnd)
      ) {
        return [
          {
            startTime: meeting.startTime,
            endTime: meeting.endTime,
          },
        ];
      }
      return [];
    }

    const { recurrenceRule } = meeting;
    const occurrences: TimeSlot[] = [];

    // Create RRule
    const rule = new RRule({
      freq: this.mapFrequency(recurrenceRule.frequency),
      interval: recurrenceRule.interval,
      dtstart: meeting.startTime,
      until: recurrenceRule.until,
      byweekday: recurrenceRule.byDay.length > 0 ? recurrenceRule.byDay : undefined,
    });

    // Get all occurrences in the range
    const instances = rule.between(rangeStart, rangeEnd, true);

    // Calculate duration
    const duration = meeting.endTime.getTime() - meeting.startTime.getTime();

    // Process exceptions
    const skipDates = new Set<string>();
    const cancelDates = new Set<string>();

    if (meeting.exceptions) {
      for (const exception of meeting.exceptions) {
        const dateStr = exception.exceptionDate.toISOString();
        if (exception.exceptionType === ExceptionType.SKIP) {
          skipDates.add(dateStr);
        } else if (exception.exceptionType === ExceptionType.CANCEL) {
          cancelDates.add(dateStr);
        }
      }
    }

    for (const instance of instances) {
      const instanceStr = instance.toISOString();

      // Skip if this instance is in the skip or cancel list
      if (skipDates.has(instanceStr) || cancelDates.has(instanceStr)) {
        continue;
      }

      const endTime = new Date(instance.getTime() + duration);

      occurrences.push({
        startTime: instance,
        endTime: endTime,
      });
    }

    return occurrences;
  }

  public getAllOccurrencesInRange(
    meetings: MeetingWithRecurrence[],
    rangeStart: Date,
    rangeEnd: Date
  ): Map<string, TimeSlot[]> {
    const occurrencesByResource = new Map<string, TimeSlot[]>();

    for (const meeting of meetings) {
      const occurrences = this.expandRecurringMeeting(
        meeting,
        rangeStart,
        rangeEnd
      );

      if (occurrences.length > 0) {
        const existing = occurrencesByResource.get(meeting.resourceId) || [];
        occurrencesByResource.set(meeting.resourceId, [...existing, ...occurrences]);
      }
    }

    return occurrencesByResource;
  }

  public getOccurrencesForNext30Days(
    meeting: MeetingWithRecurrence
  ): TimeSlot[] {
    const now = new Date();
    const end = addDays(now, 30);
    return this.expandRecurringMeeting(meeting, now, end);
  }

  public getOccurrencesForSpecificDay(
    meeting: MeetingWithRecurrence,
    date: Date
  ): TimeSlot[] {
    const start = startOfDay(date);
    const end = endOfDay(date);
    return this.expandRecurringMeeting(meeting, start, end);
  }
}
