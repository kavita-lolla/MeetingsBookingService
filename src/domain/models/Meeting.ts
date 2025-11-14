export interface Meeting {
  id: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RecurrenceRule {
  id?: string;
  meetingId?: string;
  frequency: RecurrenceFrequency;
  interval: number;
  byDay: number[];
  until?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RecurrenceException {
  id?: string;
  recurrenceRuleId?: string;
  exceptionType: ExceptionType;
  exceptionDate: Date;
  reason?: string;
  createdAt?: Date;
}

export enum RecurrenceFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum ExceptionType {
  SKIP = 'SKIP',
  CANCEL = 'CANCEL',
}

export interface MeetingWithRecurrence extends Meeting {
  recurrenceRule?: RecurrenceRule;
  exceptions?: RecurrenceException[];
}

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
}

export interface ConflictingMeeting {
  meetingId: string;
  startTime: Date;
  endTime: Date;
}

export interface AvailabilitySlot {
  startTime: Date;
  endTime: Date;
}
