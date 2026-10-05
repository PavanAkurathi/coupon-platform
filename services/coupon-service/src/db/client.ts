import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, {
    max: 10,
    connect_timeout: 3,
    idle_timeout: 20,
    connection: { statement_timeout: 5000 },
  });
  return { client, db: drizzle(client, { schema }) };
}
export type Database = ReturnType<typeof connectDatabase>['db'];
