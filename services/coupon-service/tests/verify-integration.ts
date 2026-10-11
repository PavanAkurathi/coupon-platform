import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createApp } from '../src/app';
import { connectDatabase } from '../src/db/client';
import { createCouponStore } from '../src/db/store';
import { createPostgresRateLimiter } from '../src/rate-limit-postgres';

// This runner never uses DATABASE_URL/API_URL from the caller. All records and
// rate-limit windows live in a fresh, disposable Postgres container on loopback.
const root = resolve(import.meta.dir, '../../..');
const image = 'postgres:16-alpine';
const container = `coupon-verification-${crypto.randomUUID()}`;
const scratch = await mkdtemp(join(tmpdir(), 'coupon-integration-'));
const childEnv = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'test' };
let child: ReturnType<typeof Bun.spawn> | undefined;
let database: ReturnType<typeof connectDatabase> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let started = false;
let interrupted = false;

const interrupt = () => { interrupted = true; child?.kill(); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

async function command(args: string[], options: { env?: Record<string, string>; quiet?: boolean; allowFailure?: boolean; cleanup?: boolean } = {}) {
  if (interrupted && !options.cleanup) throw new Error('Verification interrupted.');
  child = Bun.spawn(args, {
    cwd: scratch, env: { ...childEnv, ...options.env }, stdin: 'ignore',
    stdout: options.quiet ? 'pipe' : 'inherit', stderr: options.quiet ? 'pipe' : 'inherit',
  });
  const [code, output, error] = await Promise.all([
    child.exited,
    child.stdout instanceof ReadableStream ? new Response(child.stdout).text() : Promise.resolve(''),
    child.stderr instanceof ReadableStream ? new Response(child.stderr).text() : Promise.resolve(''),
  ]);
  child = undefined;
  if (code !== 0 && !options.allowFailure) throw new Error(`${args[0]} failed (${code}). ${error.trim()}`);
  return { code, output: output.trim() };
}

try {
  // Never pull or install dependencies implicitly, and never use Compose volumes.
  await command(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], { quiet: true });
  console.info('Starting a fresh local Postgres database (no persistent volume).');
  started = true;
  await command(['docker', 'run', '--detach', '--rm', '--pull=never', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', 'POSTGRES_USER=coupon', '--env', 'POSTGRES_DB=coupon_verification',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', image], { quiet: true });
  const port = (await command(['docker', 'port', container, '5432/tcp'], { quiet: true })).output.match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error('Could not resolve the isolated loopback database port.');
  const deadline = Date.now() + 30_000;
  // The image first starts a Unix-socket-only initialization server. Wait for
  // TCP readiness so that transient initialization cannot race the migrations.
  while ((await command(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'coupon', '-d', 'coupon_verification'], { quiet: true, allowFailure: true })).code !== 0) {
    if (Date.now() >= deadline) throw new Error('Disposable Postgres did not become ready.');
    await Bun.sleep(250);
  }
  const databaseUrl = `postgres://coupon@127.0.0.1:${port}/coupon_verification`;
  database = connectDatabase(databaseUrl);
  await migrate(database.db, { migrationsFolder: join(root, 'services/coupon-service/drizzle') });
  const app = createApp({
    store: createCouponStore(database.db, { evidenceWindowDays: 30 }),
    limiter: createPostgresRateLimiter(database.db),
    anonymousPerMinute: 100_000,
  });
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (request) => app.fetch(request) });
  const apiUrl = `http://127.0.0.1:${server.port}`;
  const health = await fetch(`${apiUrl}/health`);
  if (!health.ok) throw new Error('Isolated API health check failed.');
  console.info('Running the HTTP, database, operator CLI and Postgres limiter checks.');
  await command([process.execPath, '--no-env-file', join(root, 'services/coupon-service/tests/integration.ts')], {
    env: { DATABASE_URL: databaseUrl, API_URL: apiUrl },
  });
} finally {
  child?.kill();
  try {
    await server?.stop(true);
    await database?.client.end({ timeout: 3 });
  } finally {
    // A unique name limits cleanup to the container created by this invocation.
    if (started) await command(['docker', 'rm', '--force', container], { quiet: true, allowFailure: true, cleanup: true });
    await rm(scratch, { recursive: true, force: true });
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
console.info('Verification passed; the temporary database and server were removed.');
