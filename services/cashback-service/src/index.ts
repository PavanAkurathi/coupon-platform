import { app } from './app';
const server = Bun.serve({hostname: '0.0.0.0', port: Number(process.env.PORT ?? 3003), fetch: app.fetch});
console.log('cashback-service listening on ' + server.port);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(); process.exit(0); });
