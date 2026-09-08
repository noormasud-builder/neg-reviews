import type { Booking, GLClient, SearchWindow, Trainer, TrainingEvent } from '../src/gl/types.js';
import type { FullGLClient } from '../src/gl/index.js';

/**
 * Real rows pulled from the Get Licensed database on 2026-09-08, so the test
 * harness exercises the same messiness production will see: duplicate bookings,
 * inconsistent capitalisation, junk test records, multi-word forenames.
 */

function b(
  id: number, name: string, lname: string, email: string,
  course_id: number, location_id: number, course_start_date: string,
  result = 'Awaiting Result', attendance = '',
): Booking {
  return { id, name, lname, email, course_id, location_id, course_start_date, trainer_id: 0, result, attendance };
}

export const BOOKINGS: Booking[] = [
  b(628241, 'Bishnu', 'Gurung', 'bggurung@hotmail.co.uk', 149, 51475, '2026-08-31', 'Pass', 'Attended'),

  // Event 60263 — SIA Door Supervisor, 7 Sep, trainer Tolga Beyaz
  b(631661, 'Moustafa', 'Elsebaey', 'moustafaelsebaey2005@icloud.com', 12, 60263, '2026-09-07'),
  b(631599, 'Micah', 'Annon-burke', 'mannonburke@gmail.com', 12, 60263, '2026-09-07'),
  b(631427, 'Subkhonzhon', 'Ruzibaev', 'sub.ruzibaev@gmail.com', 12, 60263, '2026-09-07'),
  b(631222, 'Anna', 'Dairion', 'annadairion@gmail.com', 12, 60263, '2026-09-07'),
  b(631153, 'Hisham', 'Hassan', 'hhishamstudent@gmail.com', 12, 60263, '2026-09-07'),
  b(631018, 'Rayan', 'Abdulaal', 'ray270707@icloud.com', 12, 60263, '2026-09-07'),
  b(630876, 'Ismail Shah', 'Syed', 'ismailssyed2@gmail.com', 12, 60263, '2026-09-07'),
  b(630717, 'Abhishek', 'Kapur', 'akapur247@gmail.com', 12, 60263, '2026-09-07'),
  b(630712, 'Abhishek', 'Kapur', 'akapur247@gmail.com', 12, 60263, '2026-09-07'),
  b(630671, 'Omar', 'Shdefat', 'omaralshdefat@icloud.com', 12, 60263, '2026-09-07'),
  b(630593, 'Yaqub', 'Hussein', 'yaqubhussein888@gmail.com', 12, 60263, '2026-09-07'),
  b(630565, 'Wilson', 'Muleya', 'wilsonmuleya01@gmail.com', 12, 60263, '2026-09-07'),
  b(629999, 'Afsgvsg', 'Sgdbdbdb', 'sggregrgeg@gmail.com', 12, 60263, '2026-09-07'),
  b(629868, 'Ruth', 'Asuamah', 'asuamahr2@gmail.com', 12, 60263, '2026-09-07'),
  b(629778, 'Sammatar', 'ali', 'sa_sammatarali@hotmail.com', 12, 60263, '2026-09-07'),
  b(629695, 'Conrod', 'PUSEY', 'conradpusey38@gmail.com', 12, 60263, '2026-09-07'),
  b(629654, 'Sammatar', 'Ali', 'sa_sammatarali@hotmail.com', 12, 60263, '2026-09-07'),
  b(629568, 'Isaac', 'Rocke', 'isaacr2@hotmail.com', 12, 60263, '2026-09-07'),
  b(629379, 'Seyed Hamed', 'Badri', 'hamedbadri85@gmail.com', 12, 60263, '2026-09-07'),
  b(629306, 'Raynard', 'Hayes', 'raynardhayes@gmail.com', 12, 60263, '2026-09-07'),
  b(629295, 'Raynard', 'Hayes', 'raynardhayes@gmail.com', 12, 60263, '2026-09-07'),
  b(629294, 'Mohammed', 'EL Jaraie', 'mohammedeljaraie@gmail.com', 12, 60263, '2026-09-07'),
  b(629289, 'Mohammed', 'Ahmed', 'farhadith@gmail.com', 12, 60263, '2026-09-07'),
  b(629225, 'Elea', 'Luzi', 'e.luzi@bbk.ac.uk', 12, 60263, '2026-09-07'),
  b(628989, 'Mohammed', 'Ahmed', 'farhadith@gmail.com', 12, 60263, '2026-09-07'),
  b(628825, 'Juan', 'Sebastian Rojas Gomez', 'jsrg2405@gmail.com', 12, 60263, '2026-09-07'),
  b(628820, 'Juan', 'Sebastian Rojas Gomez', 'jsrg2405@gmail.com', 12, 60263, '2026-09-07'),
  b(628817, 'Juan', 'Sebastian Rojas Gomez', 'jsrg2405@gmail.com', 12, 60263, '2026-09-07'),
  b(628531, 'Masoud', 'Mirzaei', 'masoud_67@yahoo.com', 12, 60263, '2026-09-07'),
  b(628365, 'Muhammad', 'Mangera', 'muhammad.mangera@outlook.com', 12, 60263, '2026-09-07'),

  // Other "Mohammed" bookings on different events in the window
  b(632250, 'Mohammed', 'Hoque', 'mhoque@gmail.com', 12, 60901, '2026-09-08'),
  b(631390, 'Mohammed', 'Romaan', 'mromaan@gmail.com', 12, 60755, '2026-09-07'),
  b(630676, 'Mohammed', 'Islam', 'mislam@gmail.com', 12, 60755, '2026-09-07'),
  b(630544, 'Mohammed joinul', 'Islam', 'mjislam@gmail.com', 12, 60755, '2026-09-07'),
  b(630432, 'Mohammed', 'Saoudi', 'msaoudi@gmail.com', 12, 60410, '2026-08-31'),

  // A CCTV learner on one of Tolga's events, for the trainer path
  b(627001, 'Daniel', 'Okonkwo', 'd.okonkwo@gmail.com', 13, 61671, '2026-09-04', 'Pass', 'Attended'),
  b(627002, 'Danielle', 'Okoro', 'dokoro@gmail.com', 13, 61671, '2026-09-04'),
];

export const TRAINERS: Trainer[] = [
  { id: 300, first_name: 'Tolga', last_name: 'Beyaz', status: 'active' },
  { id: 322, first_name: 'Muhammad', last_name: 'Ahmed', status: 'active' },
  { id: 57, first_name: 'Ahmed', last_name: 'Imtiaz', status: 'active' },
];

export const EVENTS: TrainingEvent[] = [
  { id: 61764, course_id: 150, start_date: '2026-09-03', trainer_id: 300, venue_id: 2 },
  { id: 61671, course_id: 13, start_date: '2026-09-04', trainer_id: 300, venue_id: 2 },
  { id: 61658, course_id: 13, start_date: '2026-08-31', trainer_id: 300, venue_id: 2 },
  { id: 61547, course_id: 149, start_date: '2026-08-28', trainer_id: 300, venue_id: 2 },
  { id: 60263, course_id: 12, start_date: '2026-09-07', trainer_id: 300, venue_id: 2 },
];

const inWindow = (d: string, w: SearchWindow) => d >= w.from && d <= w.to;

/** In-memory stand-in for the real adapters. Same interface, no network. */
export class FixtureGLClient implements GLClient {
  calls: string[] = [];

  async getBookingById(id: number): Promise<Booking | null> {
    this.calls.push(`getBookingById(${id})`);
    return BOOKINGS.find((b) => b.id === id) ?? null;
  }

  async findBookingsByEmail(email: string): Promise<Booking[]> {
    this.calls.push(`findBookingsByEmail(${email})`);
    return BOOKINGS.filter((b) => b.email.toLowerCase() === email.toLowerCase());
  }

  async findBookingsByName(query: string, window: SearchWindow): Promise<Booking[]> {
    this.calls.push(`findBookingsByName(${query}, ${window.from}..${window.to}, courses=${window.courseIds ?? 'any'})`);
    const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1] : '';

    return BOOKINGS.filter((b) => {
      if (!inWindow(b.course_start_date, window)) return false;
      if (window.courseIds?.length && !window.courseIds.includes(b.course_id)) return false;
      const bf = b.name.toLowerCase();
      const bl = b.lname.toLowerCase();
      const firstHit = !!first && (bf.startsWith(first) || first.startsWith(bf));
      const lastHit = !last || bl.startsWith(last) || last.startsWith(bl);
      return firstHit && (last ? lastHit || firstHit : true);
    });
  }

  async findTrainersByName(query: string): Promise<Trainer[]> {
    this.calls.push(`findTrainersByName(${query})`);
    const q = query.toLowerCase();
    return TRAINERS.filter(
      (t) =>
        t.first_name.toLowerCase().includes(q) ||
        t.last_name.toLowerCase().includes(q) ||
        `${t.first_name} ${t.last_name}`.toLowerCase().includes(q),
    );
  }

  async findEventsByTrainer(trainerId: number, window: SearchWindow): Promise<TrainingEvent[]> {
    this.calls.push(`findEventsByTrainer(${trainerId})`);
    return EVENTS.filter(
      (e) =>
        e.trainer_id === trainerId &&
        inWindow(e.start_date, window) &&
        (!window.courseIds?.length || window.courseIds.includes(e.course_id)),
    );
  }

  async findBookingsOnEvents(locationIds: number[], nameQuery?: string): Promise<Booking[]> {
    this.calls.push(`findBookingsOnEvents([${locationIds}], ${nameQuery ?? '-'})`);
    const first = nameQuery?.toLowerCase().split(/\s+/)[0];
    return BOOKINGS.filter((b) => {
      if (!locationIds.includes(b.location_id)) return false;
      if (!first) return true;
      return b.name.toLowerCase().startsWith(first) || b.lname.toLowerCase().startsWith(first);
    });
  }

  async close(): Promise<void> {}
}

export const fixtureClient = (): FullGLClient => new FixtureGLClient() as unknown as FullGLClient;
