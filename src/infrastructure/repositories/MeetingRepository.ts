import { PoolClient } from 'pg';
import { DatabaseClient } from '../database/DatabaseClient';
import {
  Meeting,
  MeetingWithRecurrence,
  RecurrenceRule,
  RecurrenceException,
} from '../../domain/models/Meeting';
import { logger } from '../logging/Logger';

export class MeetingRepository {
  private static instance: MeetingRepository;
  private db: DatabaseClient;

  private constructor() {
    this.db = DatabaseClient.getInstance();
  }

  public static getInstance(): MeetingRepository {
    if (!MeetingRepository.instance) {
      MeetingRepository.instance = new MeetingRepository();
    }
    return MeetingRepository.instance;
  }

  public async createMeeting(
    meeting: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>,
    recurrenceRule?: RecurrenceRule,
    exceptions?: RecurrenceException[],
    client?: PoolClient
  ): Promise<MeetingWithRecurrence> {
    try {
      // Insert meeting
      const meetingResult = client
        ? await client.query<Meeting>(
            `INSERT INTO meetings (resource_id, start_time, end_time)
             VALUES ($1, $2, $3)
             RETURNING id, resource_id as "resourceId", start_time as "startTime", 
                       end_time as "endTime", created_at as "createdAt", updated_at as "updatedAt"`,
            [meeting.resourceId, meeting.startTime, meeting.endTime]
          )
        : await this.db.query<Meeting>(
            `INSERT INTO meetings (resource_id, start_time, end_time)
             VALUES ($1, $2, $3)
             RETURNING id, resource_id as "resourceId", start_time as "startTime", 
                       end_time as "endTime", created_at as "createdAt", updated_at as "updatedAt"`,
            [meeting.resourceId, meeting.startTime, meeting.endTime]
          );

      const createdMeeting = meetingResult.rows[0];

      // Insert recurrence rule if provided
      let createdRecurrenceRule: RecurrenceRule | undefined;
      if (recurrenceRule) {
        const ruleResult = client
          ? await client.query<RecurrenceRule>(
              `INSERT INTO recurrence_rules (meeting_id, frequency, interval, by_day, until_date)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, meeting_id as "meetingId", frequency, interval, 
                         by_day as "byDay", until_date as "until", 
                         created_at as "createdAt", updated_at as "updatedAt"`,
              [
                createdMeeting.id,
                recurrenceRule.frequency,
                recurrenceRule.interval,
                recurrenceRule.byDay,
                recurrenceRule.until,
              ]
            )
          : await this.db.query<RecurrenceRule>(
              `INSERT INTO recurrence_rules (meeting_id, frequency, interval, by_day, until_date)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, meeting_id as "meetingId", frequency, interval, 
                         by_day as "byDay", until_date as "until", 
                         created_at as "createdAt", updated_at as "updatedAt"`,
              [
                createdMeeting.id,
                recurrenceRule.frequency,
                recurrenceRule.interval,
                recurrenceRule.byDay,
                recurrenceRule.until,
              ]
            );
        createdRecurrenceRule = ruleResult.rows[0];

        // Insert exceptions if provided
        if (exceptions && exceptions.length > 0) {
          for (const exception of exceptions) {
            if (client) {
              await client.query(
                `INSERT INTO recurrence_exceptions (recurrence_rule_id, exception_type, exception_date, reason)
                 VALUES ($1, $2, $3, $4)`,
                [
                  createdRecurrenceRule?.id,
                  exception.exceptionType,
                  exception.exceptionDate,
                  exception.reason,
                ]
              );
            } else {
              await this.db.query(
                `INSERT INTO recurrence_exceptions (recurrence_rule_id, exception_type, exception_date, reason)
                 VALUES ($1, $2, $3, $4)`,
                [
                  createdRecurrenceRule?.id,
                  exception.exceptionType,
                  exception.exceptionDate,
                  exception.reason,
                ]
              );
            }
          }
        }
      }

      logger.info('Meeting created', { meetingId: createdMeeting.id });

      return {
        ...createdMeeting,
        recurrenceRule: createdRecurrenceRule,
        exceptions,
      };
    } catch (error) {
      logger.error('Error creating meeting', error);
      throw error;
    }
  }

  public async findSingularConflictingMeetings(
    resourceId: string,
    startTime: Date,
    endTime: Date,
    excludeMeetingId?: string
  ): Promise<Meeting[]> {
    try {
      const query = excludeMeetingId
        ? `SELECT id, resource_id as "resourceId", start_time as "startTime", 
                  end_time as "endTime", created_at as "createdAt", updated_at as "updatedAt"
           FROM meetings
           WHERE resource_id = $1
           AND tstzrange(start_time, end_time) && tstzrange($2, $3)
           AND id != $4`
        : `SELECT id, resource_id as "resourceId", start_time as "startTime", 
                  end_time as "endTime", created_at as "createdAt", updated_at as "updatedAt"
           FROM meetings
           WHERE resource_id = $1
           AND tstzrange(start_time, end_time) && tstzrange($2, $3)`;

      const params = excludeMeetingId
        ? [resourceId, startTime, endTime, excludeMeetingId]
        : [resourceId, startTime, endTime];

      const result = await this.db.query<Meeting>(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error finding conflicting meetings', error);
      throw error;
    }
  }

  public async findMeetingsByResourceAndDateRange(
    resourceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<MeetingWithRecurrence[]> {
    try {
      const result = await this.db.query<any>(
        `SELECT 
          m.id, m.resource_id as "resourceId", m.start_time as "startTime", 
          m.end_time as "endTime", m.created_at as "createdAt", m.updated_at as "updatedAt",
          r.id as "recurrence_id", r.frequency, r.interval, 
          r.by_day as "byDay", r.until_date as "until"
         FROM meetings m
         LEFT JOIN recurrence_rules r ON m.id = r.meeting_id
         WHERE m.resource_id = $1
         AND (
           (m.start_time >= $2 AND m.start_time < $3)
           OR (m.end_time > $2 AND m.end_time <= $3)
           OR (m.start_time <= $2 AND m.end_time <= $3)
           OR (r.until_date is NULL OR r.until_date >$2)
           OR r.id IS NOT NULL
         )
         ORDER BY m.start_time ASC`,
        [resourceId, startTime, endTime]
      );

      const meetings: MeetingWithRecurrence[] = [];
      for (const row of result.rows) {
        const meeting: MeetingWithRecurrence = {
          id: row.id,
          resourceId: row.resourceId,
          startTime: row.startTime,
          endTime: row.endTime,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };

        if (row.recurrence_id) {
          meeting.recurrenceRule = {
            id: row.recurrence_id,
            meetingId: row.id,
            frequency: row.frequency,
            interval: row.interval,
            byDay: row.byDay,
            until: row.until,
          };

          // Fetch exceptions
          const exceptionsResult = await this.db.query<RecurrenceException>(
            `SELECT id, recurrence_rule_id as "recurrenceRuleId", 
                    exception_type as "exceptionType", exception_date as "exceptionDate", 
                    reason, created_at as "createdAt"
             FROM recurrence_exceptions
             WHERE recurrence_rule_id = $1`,
            [row.recurrence_id]
          );
          meeting.exceptions = exceptionsResult.rows;
        }

        meetings.push(meeting);
      }

      return meetings;
    } catch (error) {
      logger.error('Error finding meetings by resource and date range', error);
      throw error;
    }
  }

  public async findMeetingById(id: string): Promise<MeetingWithRecurrence | null> {
    try {
      const result = await this.db.query<any>(
        `SELECT 
          m.id, m.resource_id as "resourceId", m.start_time as "startTime", 
          m.end_time as "endTime", m.created_at as "createdAt", m.updated_at as "updatedAt",
          r.id as "recurrence_id", r.frequency, r.interval, 
          r.by_day as "byDay", r.until_date as "until"
         FROM meetings m
         LEFT JOIN recurrence_rules r ON m.id = r.meeting_id
         WHERE m.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const meeting: MeetingWithRecurrence = {
        id: row.id,
        resourceId: row.resourceId,
        startTime: row.startTime,
        endTime: row.endTime,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

      if (row.recurrence_id) {
        meeting.recurrenceRule = {
          id: row.recurrence_id,
          meetingId: row.id,
          frequency: row.frequency,
          interval: row.interval,
          byDay: row.byDay,
          until: row.until,
        };

        const exceptionsResult = await this.db.query<RecurrenceException>(
          `SELECT id, recurrence_rule_id as "recurrenceRuleId", 
                  exception_type as "exceptionType", exception_date as "exceptionDate", 
                  reason, created_at as "createdAt"
           FROM recurrence_exceptions
           WHERE recurrence_rule_id = $1`,
          [row.recurrence_id]
        );
        meeting.exceptions = exceptionsResult.rows;
      }

      return meeting;
    } catch (error) {
      logger.error('Error finding meeting by id', error);
      throw error;
    }
  }

  public async findAllMeetingsWithRecurrence(): Promise<MeetingWithRecurrence[]> {
    try {
      const result = await this.db.query<any>(
        `SELECT 
          m.id, m.resource_id as "resourceId", m.start_time as "startTime", 
          m.end_time as "endTime", m.created_at as "createdAt", m.updated_at as "updatedAt",
          r.id as "recurrence_id", r.frequency, r.interval, 
          r.by_day as "byDay", r.until_date as "until"
         FROM meetings m
         LEFT JOIN recurrence_rules r ON m.id = r.meeting_id
         ORDER BY m.start_time ASC`
      );

      const meetings: MeetingWithRecurrence[] = [];
      for (const row of result.rows) {
        const meeting: MeetingWithRecurrence = {
          id: row.id,
          resourceId: row.resourceId,
          startTime: row.startTime,
          endTime: row.endTime,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };

        if (row.recurrence_id) {
          meeting.recurrenceRule = {
            id: row.recurrence_id,
            meetingId: row.id,
            frequency: row.frequency,
            interval: row.interval,
            byDay: row.byDay,
            until: row.until,
          };

          const exceptionsResult = await this.db.query<RecurrenceException>(
            `SELECT id, recurrence_rule_id as "recurrenceRuleId", 
                    exception_type as "exceptionType", exception_date as "exceptionDate", 
                    reason, created_at as "createdAt"
             FROM recurrence_exceptions
             WHERE recurrence_rule_id = $1`,
            [row.recurrence_id]
          );
          meeting.exceptions = exceptionsResult.rows;
        }

        meetings.push(meeting);
      }

      return meetings;
    } catch (error) {
      logger.error('Error finding all meetings with recurrence', error);
      throw error;
    }
  }
}
