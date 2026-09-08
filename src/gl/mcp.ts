import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Booking, GLClient, SearchWindow, Trainer, TrainingEvent } from './types.js';

const BOOKING_COLUMNS = [
  'id', 'name', 'lname', 'email', 'telephone', 'course_id',
  'location_id', 'course_start_date', 'trainer_id', 'result', 'attendance',
];

/**
 * Talks to the existing GL-Assist MCP server. This is the *testing* adapter.
 *
 * Known limits, inherited from the MCP tool itself:
 *  - hard cap of 100 rows per call, so wide name searches get paginated
 *  - filters are a fixed vocabulary; there is no `location_id IN (...)`, so
 *    the trainer path issues one call per event
 * Both go away with the mysql adapter.
 */
export class McpGLClient implements GLClient {
  private client: Client;
  private connected = false;

  constructor(private url: string, private token: string) {
    this.client = new Client({ name: 'gl-review-responder', version: '1.0.0' }, { capabilities: {} });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    await this.client.connect(transport);
    this.connected = true;
  }

  private async call(args: Record<string, unknown>): Promise<any> {
    await this.ensureConnected();
    const res: any = await this.client.callTool({ name: 'GetLicensedAssist', arguments: args });
    const block = res?.content?.find((c: any) => c.type === 'text');
    if (!block) return null;
    try {
      return JSON.parse(block.text).result;
    } catch {
      throw new Error(`GL-Assist returned non-JSON: ${String(block.text).slice(0, 300)}`);
    }
  }

  async getBookingById(id: number): Promise<Booking | null> {
    const r = await this.call({
      action: 'search', table: 'order_courses', id, columns: BOOKING_COLUMNS,
    });
    return (r?.result as Booking) ?? null;
  }

  async findBookingsByEmail(email: string): Promise<Booking[]> {
    const r = await this.call({
      action: 'search', table: 'order_courses', search: email,
      columns: BOOKING_COLUMNS, limit: 50, sort_by: 'id', sort_order: 'desc',
    });
    // `search` is a fuzzy full-text sweep, so re-assert the exact email here.
    return (r?.results ?? []).filter(
      (b: Booking) => b.email?.toLowerCase() === email.toLowerCase(),
    );
  }

  async findBookingsByName(query: string, window: SearchWindow): Promise<Booking[]> {
    const courseIds = window.courseIds?.length ? window.courseIds : [undefined];
    const out: Booking[] = [];

    for (const courseId of courseIds) {
      const filters: Record<string, unknown> = {
        date_column: 'course_start_date',
        date_from: window.from,
        date_to: window.to,
      };
      if (courseId !== undefined) filters.course_id = courseId;

      const r = await this.call({
        action: 'search', table: 'order_courses', search: query, filters,
        columns: BOOKING_COLUMNS, limit: Math.min(window.limit ?? 100, 100),
        sort_by: 'course_start_date', sort_order: 'desc',
      });
      out.push(...(r?.results ?? []));
    }
    return out;
  }

  async findTrainersByName(query: string): Promise<Trainer[]> {
    const r = await this.call({
      action: 'search', table: 'trainers', search: query,
      columns: ['id', 'first_name', 'last_name', 'status'], limit: 25,
    });
    return r?.results ?? [];
  }

  async findEventsByTrainer(trainerId: number, window: SearchWindow): Promise<TrainingEvent[]> {
    const filters: Record<string, unknown> = {
      trainer_id: trainerId,
      date_column: 'start_date',
      date_from: window.from,
      date_to: window.to,
      is_null: ['cancellation_date'],
    };
    const r = await this.call({
      action: 'search', table: 'locations', filters,
      columns: ['id', 'course_id', 'start_date', 'trainer_id', 'venue_id'],
      limit: 100, sort_by: 'start_date', sort_order: 'desc',
    });
    const events: TrainingEvent[] = r?.results ?? [];
    if (window.courseIds?.length) {
      return events.filter((e) => window.courseIds!.includes(e.course_id));
    }
    return events;
  }

  /**
   * MCP has no `IN (...)`, so the trainer path fans out one call per event.
   * Capped at 25 events to keep a single review from firing 100 requests.
   */
  async findBookingsOnEvents(locationIds: number[], nameQuery?: string): Promise<Booking[]> {
    const out: Booking[] = [];
    for (const location_id of locationIds.slice(0, 25)) {
      const args: Record<string, unknown> = {
        action: 'search', table: 'order_courses', filters: { location_id },
        columns: BOOKING_COLUMNS, limit: 100,
      };
      if (nameQuery) args.search = nameQuery;
      const r = await this.call(args);
      out.push(...(r?.results ?? []));
    }
    return out;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
