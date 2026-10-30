const PRODUCTION_HOSTS = new Set(['www.pontufy.com', 'pontufy.com']);

export function isSafeRelativePath(value: string | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
}

export function resolveAppOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  const host = forwardedHost || url.host;

  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `${url.protocol}//${host}`;
  }
  if (PRODUCTION_HOSTS.has(host) || host.endsWith('.vercel.app')) {
    return `${forwardedProto}://${host}`;
  }
  return 'https://pontufy.com';
}

export function loginErrorUrl(origin: string, code: string, fallbackPath = '/login'): string {
  const raw = fallbackPath || '/login';
  const pathOnly = raw.split('?')[0];
  if (!isSafeRelativePath(pathOnly)) {
    const target = new URL('/login', origin);
    target.searchParams.set('error', code);
    return target.toString();
  }
  const target = new URL(raw, origin);
  target.searchParams.set('error', code);
  return target.toString();
}
