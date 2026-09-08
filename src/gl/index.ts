import { McpGLClient } from './mcp.js';
import { MysqlGLClient } from './mysql.js';
import type { Booking, GLClient } from './types.js';

export * from './types.js';
export { McpGLClient } from './mcp.js';
export { MysqlGLClient } from './mysql.js';

/** Both adapters expose this; the trainer path needs it. */
export interface EventFanOut {
  findBookingsOnEvents(locationIds: number[], nameQuery?: string): Promise<Booking[]>;
}

export type FullGLClient = GLClient & EventFanOut;

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

export function createGLClient(): FullGLClient {
  const adapter = (process.env.GL_ADAPTER ?? 'mcp').toLowerCase();

  if (adapter === 'mysql') {
    return new MysqlGLClient({
      host: required('GL_DB_HOST'),
      port: Number(process.env.GL_DB_PORT ?? 3306),
      user: required('GL_DB_USER'),
      password: required('GL_DB_PASSWORD'),
      database: required('GL_DB_NAME'),
    });
  }

  if (adapter === 'mcp') {
    return new McpGLClient(required('GL_MCP_URL'), required('GL_MCP_TOKEN'));
  }

  throw new Error(`Unknown GL_ADAPTER "${adapter}" — expected "mcp" or "mysql"`);
}
