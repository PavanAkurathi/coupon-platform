await import('./build');
const paths: Record<string, string> = { '/': 'index.html', '/index.html': 'index.html', '/main.js': 'main.js', '/styles.css': 'styles.css' };
const server = Bun.serve({ hostname: '127.0.0.1', port: 4175, async fetch(request) {
  const path = paths[new URL(request.url).pathname];
  if (!path || request.method !== 'GET') return new Response('Not found', { status: 404 });
  return new Response(Bun.file(`${import.meta.dir}/dist/${path}`), { headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  } });
} });
console.log(`Local: http://127.0.0.1:${server.port}`);
