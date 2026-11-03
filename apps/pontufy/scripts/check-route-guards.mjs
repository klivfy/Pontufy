// ═══════════════════════════════════════════════════════════════════════════
// check-route-guards.mjs — garante que toda rota de API declare seu modelo de
// autorização, e que o código realmente implemente o que foi declarado.
//
// Contexto (vulnerabilidade estrutural V1 do SEGURANCA-ESTRUTURAL.md):
// a autorização é aplicada dentro de cada handler, em 4 estilos diferentes, e
// o `src/proxy.ts` NÃO cobre /api (matcher exclui `api`). Não havia barreira
// mecânica: uma rota nova sem cheque nascia funcionando, e ninguém percebia.
//
// Como funciona:
//   1. enumera todos os `src/app/api/**/route.ts`;
//   2. classifica o modelo de guarda detectado no código;
//   3. compara com `route-guards.json` (manifesto versionado);
//   4. falha se: rota sem entrada no manifesto, entrada órfã, ou classe
//      detectada diferente da declarada.
//
// Adicionar rota nova ⇒ é obrigatório editar o manifesto e dizer qual é o
// modelo de autorização. Decisão explícita, não esquecimento.
//
// Uso:
//   node scripts/check-route-guards.mjs            # verifica (CI)
//   node scripts/check-route-guards.mjs --update   # regrava (revisar diff!)
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(APP_DIR, 'src', 'app', 'api');
const MANIFEST = path.join(APP_DIR, 'route-guards.json');

/** Modelos de autorização possíveis. */
const POLICIES = [
  'requireHrAdmin',
  'inline:admin_rh',
  'inline:admin_rh_or_super_admin',
  'auth:super_admin_domain',
  'session',
  'cron:bearer',
  'signature',
  'public',
  'alias',
];

function listRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

/** Converte o caminho do arquivo na rota HTTP (ex.: /api/admin/skills/pdi). */
function toRoutePath(file) {
  const rel = path.relative(path.join(APP_DIR, 'src', 'app'), file);
  return `/${rel.replace(/\\/g, '/').replace(/\/route\.ts$/, '')}`;
}

function detectPolicy(source) {
  // Alias: apenas reexporta um handler protegido em outro arquivo.
  if (/^\s*export\s*\{[^}]*\}\s*from\s*'@\/app\/api\//m.test(source)) return 'alias';

  if (source.includes('authorizeCronRequest')) return 'cron:bearer';

  if (
    source.includes('constructEventAsync') ||
    source.includes('x-affiliate-signature') ||
    source.includes('assertLomadeePostbackToken') ||
    source.includes('x-setup-secret')
  ) {
    return 'signature';
  }

  if (source.includes('requireHrAdmin')) return 'requireHrAdmin';

  // Guarda de plataforma: relê papel + domínio do banco (V5).
  if (source.includes('requireSuperAdmin')) return 'auth:super_admin_domain';

  if (/role\s*!==\s*'admin_rh'\s*&&\s*role\s*!==\s*'super_admin'/.test(source)) {
    return 'inline:admin_rh_or_super_admin';
  }
  if (/role\s*!==\s*'admin_rh'/.test(source)) return 'inline:admin_rh';

  if (/role\s*!==\s*'super_admin'/.test(source)) return 'auth:super_admin_domain';

  if (source.includes('getSessionContext')) return 'session';

  return 'public';
}

const routes = listRouteFiles(API_DIR)
  .map((file) => {
    const source = readFileSync(file, 'utf8');
    return { route: toRoutePath(file), policy: detectPolicy(source) };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

if (process.argv.includes('--update')) {
  const manifest = Object.fromEntries(routes.map((r) => [r.route, r.policy]));
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`✅ Manifesto regravado com ${routes.length} rotas. Revise o diff antes de commitar.`);
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.error('❌ route-guards.json ausente. Rode: node scripts/check-route-guards.mjs --update');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const problems = [];

for (const { route, policy } of routes) {
  const declared = manifest[route];
  if (!declared) {
    problems.push(`SEM DECLARAÇÃO  ${route}  (detectado: ${policy})`);
    continue;
  }
  if (!POLICIES.includes(declared)) {
    problems.push(`POLÍTICA INVÁLIDA ${route}  (declarado: ${declared})`);
    continue;
  }
  if (declared !== policy) {
    problems.push(`DIVERGENTE       ${route}  declarado=${declared} detectado=${policy}`);
  }
}

const knownRoutes = new Set(routes.map((r) => r.route));
for (const route of Object.keys(manifest)) {
  if (!knownRoutes.has(route)) problems.push(`ÓRFÃ             ${route}  (não existe mais no código)`);
}

if (problems.length > 0) {
  console.error(`\n❌ ${problems.length} problema(s) de autorização declarada:\n`);
  for (const problem of problems) console.error(`   ${problem}`);
  console.error(
    '\nToda rota precisa de uma entrada em apps/pontufy/route-guards.json.\n' +
      'Rode `node scripts/check-route-guards.mjs --update` e REVISE o diff — o manifesto\n' +
      'não pode ser atualizado às cegas, ele é a decisão de autorização da rota.\n',
  );
  process.exit(1);
}

const byPolicy = routes.reduce((acc, r) => {
  acc[r.policy] = (acc[r.policy] ?? 0) + 1;
  return acc;
}, {});

console.log(`✅ ${routes.length} rotas com autorização declarada e conferida.`);
for (const [policy, count] of Object.entries(byPolicy).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(count).padStart(3)}  ${policy}`);
}
