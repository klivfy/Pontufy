/* Pontufy Service Worker — offline resiliente.
 *
 * Estratégias:
 *  - Assets estáticos hasheados (_next/static, /icons, /manifest.json):
 *    Cache-First com revalidação em background (immutáveis).
 *  - Navegações (documentos): NETWORK-ONLY com página offline mínima como
 *    fallback. HTML de rota autenticada NUNCA é cacheado.
 *  - /api/* NUNCA é cacheado: contém dados autenticados e tenant-scoped.
 *
 * Por que navegação não é cacheada (F2.10):
 *   A versão anterior gravava toda navegação bem-sucedida em PAGE_CACHE e, no
 *   offline, servia `/dashboard` em cache como fallback. Em dispositivo
 *   compartilhado (cenário real de treinamento corporativo), outro usuário
 *   abria o dashboard/perfil do anterior depois do logout.
 */
const VERSION = 'pontufy-v2';
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_BODY = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pontufy — Sem conexão</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #0a0a0a; color: #e5e5e5; font-family: system-ui, sans-serif; }
    .box { text-align: center; padding: 24px; }
    .title { font-weight: 800; font-size: 20px; }
    .brand { color: #10b981; }
    p { color: #9ca3af; font-size: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="title"><span class="brand">Pontu</span>fy</div>
    <p>Você está offline.<br/>Reconecte para continuar suas aulas.</p>
  </div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(['/manifest.json']))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function staticCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Revalidação em background: atualiza o cache sem bloquear a resposta.
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const cache = caches.open(STATIC_CACHE);
          cache.then((c) => c.put(request, res));
        }
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = caches.open(STATIC_CACHE);
      cache.then((c) => c.put(request, res.clone()));
    }
    return res;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function navigationOnlineOnly(request) {
  try {
    return await fetch(request);
  } catch {
    // Sem rede: página offline neutra. Nada de HTML autenticado do cache.
    return new Response(OFFLINE_BODY, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dados sensíveis (auth + multi-tenant): nunca em cache.
  if (url.pathname.startsWith('/api/')) return;

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(staticCacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationOnlineOnly(request));
  }
});
