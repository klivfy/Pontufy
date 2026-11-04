import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TICKET_TTL_MS = 90_000;

function ticketSecret(): string {
  return process.env.AUTH_SECRET || 'pontufy-dev-insecure-replace-in-production';
}

function sign(body: string): string {
  return createHmac('sha256', ticketSecret()).update(body).digest('base64url');
}

export function issueGoogleBridgeTicket(userId: string): string {
  const payload = {
    uid: userId,
    exp: Date.now() + TICKET_TTL_MS,
    n: randomBytes(16).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyGoogleBridgeTicket(ticket: string): string | null {
  if (!ticket || typeof ticket !== 'string' || ticket.length > 512) return null;
  const sep = ticket.lastIndexOf('.');
  if (sep <= 0) return null;
  const body = ticket.slice(0, sep);
  const sig = ticket.slice(sep + 1);
  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      uid?: string;
      exp?: number;
    };
    if (!payload.uid || typeof payload.uid !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
