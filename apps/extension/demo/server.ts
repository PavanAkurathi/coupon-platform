const page = Bun.file(`${import.meta.dir}/checkout.html`);
const script = await Bun.build({ entrypoints: [`${import.meta.dir}/checkout.ts`], target: "browser", minify: false });
if (!script.success || !script.outputs[0]) throw new Error("Demo build failed");
const js = await script.outputs[0].text();
const server = Bun.serve({
  hostname: "localhost", port: 4173,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const headers = {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
    };
    if (url.pathname === "/checkout") return new Response(page, { headers });
    if (url.pathname === "/demo.js") return new Response(js, { headers: { ...headers, "Content-Type": "text/javascript" } });
    return new Response("Open /checkout for the local demo.", { status: 404, headers });
  },
});
console.log(`Demo checkout: ${server.url}checkout (local fixture; no real orders or payments)`);
