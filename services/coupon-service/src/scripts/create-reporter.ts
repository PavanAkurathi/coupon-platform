import { eq } from 'drizzle-orm';
import { connectDatabase } from '../db/client';
import { users } from '../db/schema';
import { hashToken } from '../domain';

const identityIndex = process.argv.indexOf('--identity');
const identity = process.argv[identityIndex + 1]?.trim().toLowerCase();
if (identityIndex < 0 || !identity || identity.startsWith('--')) {
  console.error('Usage: bun run reporter:create --identity <operator-verified-shopper-key>');
  process.exit(1);
}
const { db, client } = connectDatabase();
try {
  const identityHash = hashToken(`shopper:${identity}`);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.identityHash, identityHash)).limit(1);
  if (existing) throw new Error('This verified identity already has a reporter. Reuse its token; do not issue duplicate shopper identities.');
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const [user] = await db.insert(users).values({ identityHash, tokenHash: hashToken(token) }).returning({ id: users.id });
  // This is the only display of the token. Never store it in logs or source control.
  console.info(JSON.stringify({ userId: user?.id, token }));
} finally {
  await client.end({ timeout: 3 });
}
