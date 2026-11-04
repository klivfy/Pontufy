// ═══════════════════════════════════════════════════════════════════════════
// check-crons.mjs — contrato entre as rotas de cron e a agenda do deploy.
//
// Contexto (bug real, encontrado em 04/11): `outbox-worker` existia, tinha
// teste de domínio verde e nunca rodava em produção. Dois motivos somados:
//   1. não estava em `vercel.json` → o Vercel nunca chamava;
//   2. exportava só `POST` → o Vercel Cron chama com GET, então mesmo agendado
//      responderia 405.
// Nenhum gate olhava para isso: o lint não vê configuração, o typecheck não vê
// JSON, e o teste de unidade testava o domínio, não o encanamento.
//
// Efeito do bug: nenhum e-mail transacional saía — verificação de empresa e
// recuperação de senha inclusive. Empresa cadastrada não conseguia entrar.
//
// Este script fecha a classe inteira: toda rota de `/api/cron/*` precisa
//   (a) exportar GET, e
//   (b) estar listada na agenda de `vercel.json`;
// e nenhuma entrada da agenda pode apontar para rota inexistente.
//
// Uso:
//   node scripts/check-crons.mjs            # verifica (CI)
//   node scripts/check-crons.mjs --update   # imprime a agenda corrigida
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRON_DIR = path.join(APP_DIR, 'src', 'app', 'api', 'cron');
const VERCEL_CONFIG = path.join(APP_DIR, 'vercel.json');

/** Caminhos de rota a partir dos diretórios: /api/cron/<a>/<b>. */
function collectCronRoutes(dir, prefix = '/api/cron') {
  const routes = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;

    const routeFile = path.join(full, 'route.ts');
    const routePath = `${prefix}/${entry}`;

    try {
      statSync(routeFile);
      routes.push({ path: routePath, file: routeFile });
    } catch {
      // Diretório sem route.ts: pode ser agrupamento; desce um nível.
      routes.push(...collectCronRoutes(full, routePath));
    }
  }

  return routes;
}

/** Handlers HTTP exportados pelo arquivo (só os que o Next reconhece). */
function exportedMethods(source) {
  const methods = new Set();
  const re = /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let match;
  while ((match = re.exec(source)) !== null) methods.add(match[1]);
  return methods;
}

const problems = [];
const notes = [];

if (!statSync(CRON_DIR, { throwIfNoEntry: false })?.isDirectory()) {
  console.log('check-crons: nenhuma rota de cron encontrada — nada a verificar.');
  process.exit(0);
}

const routes = collectCronRoutes(CRON_DIR).sort((a, b) => a.path.localeCompare(b.path));
const config = JSON.parse(readFileSync(VERCEL_CONFIG, 'utf8'));
const scheduled = new Set((config.crons ?? []).map((cron) => cron.path));

for (const route of routes) {
  const source = readFileSync(route.file, 'utf8');
  const methods = exportedMethods(source);

  if (!methods.has('GET')) {
    problems.push(
      `${route.path} não exporta GET (exporta: ${[...methods].join(', ') || 'nada'}). ` +
        'O Vercel Cron chama com GET — agendar esta rota não faria efeito.',
    );
  }

  if (!scheduled.has(route.path)) {
    problems.push(
      `${route.path} existe mas NÃO está em vercel.json → nunca roda em produção. ` +
        'Adicione em "crons" ou remova a rota.',
    );
  } else {
    notes.push(`${route.path} → agendada`);
  }
}

for (const cronPath of scheduled) {
  if (!cronPath.startsWith('/api/cron/')) continue;
  if (!routes.some((route) => route.path === cronPath)) {
    problems.push(
      `vercel.json agenda ${cronPath}, mas não existe route.ts para esse caminho. ` +
        'O cron vai falhar com 404 em produção.',
    );
  }
}

if (process.argv.includes('--update')) {
  const missing = routes.filter((route) => !scheduled.has(route.path));
  console.log('Entradas ausentes em vercel.json (escolha a frequência com critério):');
  for (const route of missing) console.log(`  { "path": "${route.path}", "schedule": "..." }`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error('\n✖ Contrato de cron violado:\n');
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(
    `\n${problems.length} problema(s). Uma rota de cron que não roda é pior que uma rota ausente: ` +
      'ela parece implementada e falha em silêncio.\n',
  );
  process.exit(1);
}

console.log(`✔ ${routes.length} rota(s) de cron: todas exportam GET e estão agendadas.`);
for (const note of notes) console.log(`   ${note}`);
