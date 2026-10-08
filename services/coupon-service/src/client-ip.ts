import { isIP } from 'node:net';

// Rate limits key on the client address. Directly exposed, that is the socket
// address. Behind a hosting proxy the socket is the proxy, so every shopper would
// share one bucket; name the proxy's client header explicitly to fix that.
// Never trust a forwarding header that was not configured: clients can forge it.
export type ClientIpConfig = { header?: string; trustedHops: number };

export function clientIpConfig(env: Record<string, string | undefined> = process.env): ClientIpConfig {
  const header = env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined;
  if (header && !/^[a-z0-9-]{1,64}$/.test(header)) throw new Error('CLIENT_IP_HEADER must be a single header name.');
  const hops = env.TRUSTED_PROXY_HOPS?.trim() ? Number(env.TRUSTED_PROXY_HOPS) : 1;
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) throw new Error('TRUSTED_PROXY_HOPS must be a whole number from 1 to 5.');
  return { header, trustedHops: hops };
}

export function clientAddress(headers: Headers, socketAddress: string | undefined, config: ClientIpConfig): string | undefined {
  if (!config.header) return socketAddress;
  const raw = headers.get(config.header);
  // A request that reached the service without passing through the proxy keeps
  // its own socket address rather than an unauthenticated header value.
  if (!raw) return socketAddress;
  // X-Forwarded-For style lists: each trusted proxy appends one entry, so the
  // client is the entry just before the trusted ones. Earlier entries are forgeable.
  const entries = raw.split(',').map((entry) => entry.trim());
  const candidate = entries.length > 1 ? entries[entries.length - config.trustedHops] : entries[0];
  return candidate && isIP(candidate) ? candidate : socketAddress;
}
