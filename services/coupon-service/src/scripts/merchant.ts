import { asc, eq } from 'drizzle-orm';
import { merchantSchema } from '@repo/shared';
import { connectDatabase } from '../db/client';
import { merchants } from '../db/schema';

// Operator-only store controls. There is no HTTP route for any of these.
//   merchant add --domain <exact-host> --name <display name> --operator <id>
//   merchant disable|enable --merchant <uuid> --operator <id> --reason <text>
//   merchant list
const [command, ...args] = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  return value?.startsWith('--') ? undefined : value?.trim();
}
function required(name: string, max = 200) {
  const value = option(name);
  if (!value || value.length > max) throw new Error(`Provide ${name} (at most ${max} characters).`);
  return value;
}
// The extension matches merchants by exact hostname, so a stored domain must be one.
export function exactHostname(raw: string): string {
  const domain = raw.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) || domain.length > 253) {
    throw new Error('--domain must be the exact store hostname, such as www.example.com (no scheme, path, port or wildcard).');
  }
  return domain;
}

if (import.meta.main) {
  const { db, client } = connectDatabase();
  try {
    if (command === 'add') {
      const domain = exactHostname(required('--domain', 253));
      const name = required('--name', 100);
      required('--operator');
      const [row] = await db.insert(merchants).values({ domain, name, currency: 'USD' })
        .onConflictDoNothing({ target: merchants.domain }).returning();
      if (!row) throw new Error(`A merchant for ${domain} already exists.`);
      console.info(JSON.stringify(merchantSchema.parse({ id: row.id, domain: row.domain, name: row.name, currency: 'USD' })));
    } else if (command === 'disable' || command === 'enable') {
      const id = required('--merchant', 36);
      const operator = required('--operator');
      const reason = required('--reason', 500);
      const [row] = await db.update(merchants).set({
        enabled: command === 'enable', statusNote: reason, statusChangedBy: operator, statusChangedAt: new Date(),
      }).where(eq(merchants.id, id)).returning({ domain: merchants.domain, enabled: merchants.enabled });
      if (!row) throw new Error('Unknown merchant.');
      console.info(`${row.domain} is now ${row.enabled ? 'enabled' : 'disabled'}. The extension stops offering it on the next status check.`);
    } else if (command === 'list') {
      const rows = await db.select({ id: merchants.id, domain: merchants.domain, name: merchants.name, enabled: merchants.enabled, note: merchants.statusNote })
        .from(merchants).orderBy(asc(merchants.domain));
      console.table(rows);
    } else {
      throw new Error('Usage: merchant add|disable|enable|list. See the header of src/scripts/merchant.ts.');
    }
  } finally {
    await client.end({ timeout: 3 });
  }
}
