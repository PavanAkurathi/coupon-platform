import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from '../db/client';

const { db, client } = connectDatabase();
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  console.info('Database migrations applied.');
} finally {
  await client.end({ timeout: 3 });
}
