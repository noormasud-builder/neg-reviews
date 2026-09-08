export interface Booking {
  id: number;
  name: string;
  lname: string;
  email: string;
  telephone?: string | null;
  course_id: number;
  location_id: number;
  course_start_date: string;
  trainer_id: number;
  result?: string | null;
  attendance?: string | null;
}

export interface TrainingEvent {
  id: number;
  course_id: number;
  start_date: string;
  trainer_id: number;
  venue_id: number;
}

export interface Trainer {
  id: number;
  first_name: string;
  last_name: string;
  status: string;
}

export interface SearchWindow {
  /** YYYY-MM-DD inclusive */
  from: string;
  /** YYYY-MM-DD inclusive */
  to: string;
  /** Restrict to these course IDs, if the review names a course. */
  courseIds?: number[];
  /** Restrict to these event IDs, used by the trainer path. */
  locationIds?: number[];
  limit?: number;
}

/**
 * Everything the matcher needs from Get Licensed. Two implementations:
 * `mcp` (testing, via the existing GL-Assist MCP server) and `mysql`
 * (production, via a read-only replica). Swapping one for the other is an
 * env var — no matcher code changes.
 */
export interface GLClient {
  getBookingById(id: number): Promise<Booking | null>;
  findBookingsByEmail(email: string): Promise<Booking[]>;
  findBookingsByName(query: string, window: SearchWindow): Promise<Booking[]>;
  findTrainersByName(query: string): Promise<Trainer[]>;
  findEventsByTrainer(trainerId: number, window: SearchWindow): Promise<TrainingEvent[]>;
  close(): Promise<void>;
}
