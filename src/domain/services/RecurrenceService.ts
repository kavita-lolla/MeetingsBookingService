import { RRule, Frequency } from 'rrule';
import {
  MeetingWithRecurrence,
  RecurrenceFrequency,
  ExceptionType,
  TimeSlot,
  Meeting,
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
    };
    return frequencyMap[frequency];
  }

  public expandRecurringMeeting(
    meeting: MeetingWithRecurrence,
    rangeStart: Date,
    rangeEnd: Date
  ): Meeting[] {
    if (!meeting.recurrenceRule) {
      // Non-recurring meeting
      if (
        isWithinInterval(meeting.startTime, { start: rangeStart, end: rangeEnd }) ||
        isWithinInterval(meeting.endTime, { start: rangeStart, end: rangeEnd }) ||
        (meeting.startTime <= rangeStart && meeting.endTime >= rangeEnd)
      ) {
        return [
          {
            id: meeting.id,
            resourceId: meeting.resourceId,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
          },
        ];
      }
      return [];
    }

    const { recurrenceRule } = meeting;
    const occurrences: Meeting[] = [];

    // Create RRule
    const rule = new RRule({
      freq: this.mapFrequency(recurrenceRule.frequency),
      interval: recurrenceRule.interval,
      dtstart: meeting.startTime,
      until: recurrenceRule.until ?? addDays( new Date(), 30 ),
      byweekday: recurrenceRule.byDay.length > 0 && recurrenceRule.frequency === RecurrenceFrequency.WEEKLY? recurrenceRule.byDay : undefined,
      bymonthday: recurrenceRule.byDay.length > 0 && recurrenceRule.frequency === RecurrenceFrequency.MONTHLY ? recurrenceRule.byDay : undefined
    });

    // Get all occurrences in the range
    const instances = rule.between(rangeStart, rangeEnd, true);

    // Calculate duration
    const duration = meeting.endTime.getTime() - meeting.startTime.getTime();

    // Process exceptions
    const excludeDates = new Set<string>();

    if (meeting.exceptions) {
      for (const exception of meeting.exceptions) {
        excludeDates.add(exception.exceptionDate.toISOString());
      }
    }

    for (const instance of instances) {
      const instanceStr = instance.toISOString();

      // Skip if this instance is in the skip or cancel list
      if (excludeDates.has(instanceStr)) {
        continue;
      }

      const endTime = new Date(instance.getTime() + duration);

      occurrences.push({
        id: meeting.id,
        resourceId: meeting.resourceId,
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
