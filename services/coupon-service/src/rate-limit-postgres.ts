import { lt, sql } from 'drizzle-orm';
import type { Database } from './db/client';
import { rateLimits } from './db/schema';
import type { RateLimiter } from './domain';

// One atomic upsert per request: a new window resets the count, otherwise it
// increments. Suited to beta volume; put an edge limiter in front for public launch.
export function createPostgresRateLimiter(db: Database): RateLimiter {
  return {
    async allow(key, limit, seconds) {
      const window = sql`make_interval(secs => ${seconds})`;
      const [row] = await db.insert(rateLimits).values({ key: `coupon:limit:${key}`, windowStart: sql`now()`, count: 1 })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`CASE WHEN ${rateLimits.windowStart} <= now() - ${window} THEN 1 ELSE ${rateLimits.count} + 1 END`,
            windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= now() - ${window} THEN now() ELSE ${rateLimits.windowStart} END`,
          },
        }).returning({ count: rateLimits.count });
      // Occasionally drop expired windows so the table stays small without a scheduler.
      if (Math.random() < 0.01) await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`));
      return (row?.count ?? Number.POSITIVE_INFINITY) <= limit;
    },
    async ping() { await db.execute(sql`SELECT 1`); },
  };
}
