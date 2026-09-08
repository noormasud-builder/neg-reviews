import mysql from 'mysql2/promise';
import type { Booking, GLClient, SearchWindow, Trainer, TrainingEvent } from './types.js';

const BOOKING_COLS = `
  oc.id, oc.name, oc.lname, oc.email, oc.telephone, oc.course_id,
  oc.location_id, oc.course_start_date, oc.trainer_id, oc.result, oc.attendance
`;

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Production adapter. Needs a READ-ONLY user with SELECT on:
 *   order_courses, locations, trainers, courses
 * Nothing else. See DEV-HANDOVER.md for the exact GRANT.
 */
export class MysqlGLClient implements GLClient {
  private pool: mysql.Pool;

  constructor(cfg: MysqlConfig) {
    this.pool = mysql.createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: 5,
      dateStrings: true,
      // Belt and braces: even if the user is misconfigured, we can't write.
      flags: ['-MULTI_STATEMENTS'],
    });
  }

  async getBookingById(id: number): Promise<Booking | null> {
    const [rows] = await this.pool.query<any[]>(
      `SELECT ${BOOKING_COLS} FROM order_courses oc WHERE oc.id = ? LIMIT 1`,
      [id],
    );
    return (rows[0] as Booking) ?? null;
  }

  async findBookingsByEmail(email: string): Promise<Booking[]> {
    const [rows] = await this.pool.query<any[]>(
      `SELECT ${BOOKING_COLS} FROM order_courses oc
       WHERE oc.email = ? ORDER BY oc.id DESC LIMIT 50`,
      [email],
    );
    return rows as Booking[];
  }

  /**
   * Matches first name, last name, or the concatenation. Deliberately loose on
   * the surname — reviewers routinely sign off as "John S" or "John Smith-Jones"
   * when the booking says "John Smith". Ranking happens in the matcher.
   */
  async findBookingsByName(query: string, window: SearchWindow): Promise<Booking[]> {
    const parts = query.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1] : '';

    const where: string[] = ['oc.course_start_date BETWEEN ? AND ?'];
    const params: unknown[] = [window.from, window.to];

    const nameClauses: string[] = [];
    if (first) {
      nameClauses.push('oc.name LIKE ?');
      params.push(`${first}%`);
    }
    if (last) {
      // Either the surname matches, or its first letter does ("John S").
      nameClauses.push('oc.lname LIKE ?');
      params.push(last.length <= 2 ? `${last[0]}%` : `${last}%`);
      nameClauses.push("CONCAT(oc.name, ' ', oc.lname) LIKE ?");
      params.push(`%${query.trim()}%`);
    }
    if (nameClauses.length) where.push(`(${nameClauses.join(' OR ')})`);

    if (window.courseIds?.length) {
      where.push(`oc.course_id IN (${window.courseIds.map(() => '?').join(',')})`);
      params.push(...window.courseIds);
    }
    if (window.locationIds?.length) {
      where.push(`oc.location_id IN (${window.locationIds.map(() => '?').join(',')})`);
      params.push(...window.locationIds);
    }

    params.push(window.limit ?? 100);
    const [rows] = await this.pool.query<any[]>(
      `SELECT ${BOOKING_COLS} FROM order_courses oc
       WHERE ${where.join(' AND ')}
       ORDER BY oc.course_start_date DESC, oc.id DESC
       LIMIT ?`,
      params,
    );
    return rows as Booking[];
  }

  async findTrainersByName(query: string): Promise<Trainer[]> {
    const like = `%${query.trim()}%`;
    const [rows] = await this.pool.query<any[]>(
      `SELECT id, first_name, last_name, status FROM trainers
       WHERE deleted IS NULL
         AND (first_name LIKE ? OR last_name LIKE ?
              OR CONCAT(first_name, ' ', last_name) LIKE ?)
       LIMIT 25`,
      [like, like, like],
    );
    return rows as Trainer[];
  }

  async findEventsByTrainer(trainerId: number, window: SearchWindow): Promise<TrainingEvent[]> {
    const where = [
      '(l.trainer_id = ? OR l.take_exam_trainer_id = ?)',
      'l.start_date BETWEEN ? AND ?',
      'l.cancellation_date IS NULL',
    ];
    const params: unknown[] = [trainerId, trainerId, window.from, window.to];
    if (window.courseIds?.length) {
      where.push(`l.course_id IN (${window.courseIds.map(() => '?').join(',')})`);
      params.push(...window.courseIds);
    }
    const [rows] = await this.pool.query<any[]>(
      `SELECT l.id, l.course_id, l.start_date, l.trainer_id, l.venue_id
       FROM locations l WHERE ${where.join(' AND ')}
       ORDER BY l.start_date DESC LIMIT 100`,
      params,
    );
    return rows as TrainingEvent[];
  }

  async findBookingsOnEvents(locationIds: number[], nameQuery?: string): Promise<Booking[]> {
    if (!locationIds.length) return [];
    const params: unknown[] = [...locationIds];
    let nameClause = '';
    if (nameQuery) {
      const first = nameQuery.trim().split(/\s+/)[0];
      nameClause = " AND (oc.name LIKE ? OR oc.lname LIKE ?)";
      params.push(`${first}%`, `${first}%`);
    }
    const [rows] = await this.pool.query<any[]>(
      `SELECT ${BOOKING_COLS} FROM order_courses oc
       WHERE oc.location_id IN (${locationIds.map(() => '?').join(',')})${nameClause}
       ORDER BY oc.id DESC LIMIT 200`,
      params,
    );
    return rows as Booking[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
