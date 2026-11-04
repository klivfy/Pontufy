// Diagnóstico do fluxo de sessão: login → cookie → rota autenticada.
// Não faz parte da suíte. Uso: node tests/helpers/probe-auth.mjs
const BASE = process.env.PW_BASE_URL ?? 'http://127.0.0.1:3100';
const jar = new Map();

function saveCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: cookieHeader() } : {}) },
  });
  saveCookies(response);
  return response;
}

const csrfRes = await call('/api/auth/csrf');
const { csrfToken } = await csrfRes.json();
console.log('csrf:', Boolean(csrfToken), '| cookies:', [...jar.keys()].join(', '));

const login = await call('/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    csrfToken,
    email: 'joao@empresaalpha.com',
    password: '123456',
    callbackUrl: '/dashboard',
  }).toString(),
});
console.log('login status:', login.status, '| location:', login.headers.get('location'));
console.log('cookies após login:', [...jar.keys()].join(', '));

for (const path of ['/api/users/me', '/api/courses']) {
  const res = await call(path);
  const body = await res.text();
  console.log(`\n${path} -> ${res.status}`);
  console.log('  body:', body.slice(0, 240));
}

const session = await call('/api/auth/session');
console.log('\n/api/auth/session ->', session.status, '|', (await session.text()).slice(0, 240));
