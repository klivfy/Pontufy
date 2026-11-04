// Verifica a duplicidade de navegação na área admin.
// Conta marcadores estruturais no HTML servido, com sessão de admin_rh real.
const BASE = process.env.PW_BASE_URL ?? 'http://localhost:3000';
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

const csrf = await (await call('/api/auth/csrf')).json();
await call('/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: 'admin@empresaalpha.com',
    password: '123456',
    callbackUrl: '/admin',
  }).toString(),
});

const rotas = ['/admin', '/admin/team', '/admin/wizard', '/admin/settings/branding'];

for (const rota of rotas) {
  const response = await call(rota);
  const html = await response.text();

  // Cada sidebar renderiza uma vez a seção "Visão Geral".
  const secoes = (html.match(/Visão Geral/g) ?? []).length;
  const placeholders = (html.match(/Placeholder - actual title/g) ?? []).length;
  const bordaDupla = (html.match(/Pontufy Admin/g) ?? []).length;

  console.log(
    `${rota.padEnd(26)} HTTP ${response.status} | seções de nav: ${secoes} | marca do topo: ${bordaDupla} | placeholder: ${placeholders}`,
  );
}
