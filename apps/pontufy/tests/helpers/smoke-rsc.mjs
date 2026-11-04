// Smoke de renderização autenticada: login + GET em páginas migradas para RSC.
// Verifica status e presença de conteúdo no HTML servido (não só build).
const BASE = process.env.PW_BASE_URL ?? 'http://127.0.0.1:3100';
const jar = new Map();

function saveCookies(response) {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(init.headers ?? {}),
      ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
  });
  saveCookies(response);
  return response;
}

const csrfRes = await call('/api/auth/csrf');
const { csrfToken } = await csrfRes.json();

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
console.log(`login: ${login.status}`);

const pages = [
  { path: '/certificados', expect: 'Meus Certificados' },
  { path: '/loja', expect: 'Clube de Benefícios' },
];

for (const { path, expect } of pages) {
  const response = await call(path);
  const html = await response.text();
  const found = html.includes(expect);
  const hasSpinner = html.includes('animate-spin');
  console.log(`${path} -> ${response.status} | conteúdo: ${found ? 'ok' : 'AUSENTE'} | spinner inicial: ${hasSpinner ? 'sim' : 'não'}`);
}
