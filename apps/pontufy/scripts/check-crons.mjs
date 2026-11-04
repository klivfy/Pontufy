// ═══════════════════════════════════════════════════════════════════════════
// check-crons.mjs — contrato entre as rotas de cron, a agenda do deploy e os
// disparos que não vêm de cron.
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
// Este script fecha a classe inteira. Toda rota de `/api/cron/*` precisa:
//   (a) exportar GET,
//   (b) estar na agenda de `vercel.json` OU declarada em `cron-manual.json`
//       com um motivo escrito — disparo manual, inline, ou limite de plano.
// E nenhuma das duas listas pode apontar para rota inexistente, nem uma rota
// pode estar nos dois lugares (declaração esquecida).
//
// Uso:
//   node scripts/check-crons.mjs            # verifica (CI)
//   node scripts/check-crons.mjs --update   # lista rotas sem agenda
// ═══════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRON_DIR = path.join(APP_DIR, 'src', 'app', 'api', 'cron');
const VERCEL_CONFIG = path.join(APP_DIR, 'vercel.json');
const MANUAL_MANIFEST = path.join(APP_DIR, 'cron-manual.json');

/** Motivo curto demais não explica nada — vira ruído no manifesto. */
const MIN_REASON_LENGTH = 20;

/** Caminhos de rota a partir dos diretórios: /api/cron/<a>/<b>. */
function collectCronRoutes(dir, prefix = '/api/cron') {
  const routes = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;

    const routeFile = path.join(full, 'route.ts');
    const routePath = `${prefix}/${entry}`;

    if (existsSync(routeFile)) {
      routes.push({ path: routePath, file: routeFile });
    } else {
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

if (!existsSync(CRON_DIR)) {
  console.log('check-crons: nenhuma rota de cron encontrada — nada a verificar.');
  process.exit(0);
}

const problems = [];
const routes = collectCronRoutes(CRON_DIR).sort((a, b) => a.path.localeCompare(b.path));
const routePaths = new Set(routes.map((route) => route.path));

const config = JSON.parse(readFileSync(VERCEL_CONFIG, 'utf8'));
const scheduled = new Set((config.crons ?? []).map((cron) => cron.path));

const manual = existsSync(MANUAL_MANIFEST)
  ? JSON.parse(readFileSync(MANUAL_MANIFEST, 'utf8'))
  : {};

for (const route of routes) {
  const methods = exportedMethods(readFileSync(route.file, 'utf8'));

  if (!methods.has('GET')) {
    problems.push(
      `${route.path} não exporta GET (exporta: ${[...methods].join(', ') || 'nada'}). ` +
        'O Vercel Cron chama com GET — agendar esta rota não faria efeito.',
    );
  }

  const isScheduled = scheduled.has(route.path);
  const isManual = Object.prototype.hasOwnProperty.call(manual, route.path);

  if (isScheduled && isManual) {
    problems.push(
      `${route.path} está em vercel.json E em cron-manual.json. ` +
        'Escolha um: a declaração manual virou mentira.',
    );
  }

  if (!isScheduled && !isManual) {
    problems.push(
      `${route.path} existe mas não está em vercel.json nem em cron-manual.json → ` +
        'ninguém a dispara. Agende ou declare o motivo do disparo manual.',
    );
  }

  if (isManual && String(manual[route.path]).trim().length < MIN_REASON_LENGTH) {
    problems.push(
      `${route.path} está em cron-manual.json sem motivo suficiente ` +
        `(mínimo ${MIN_REASON_LENGTH} caracteres). Sem motivo, "manual" é sinônimo de esquecido.`,
    );
  }
}

for (const cronPath of scheduled) {
  if (!cronPath.startsWith('/api/cron/')) continue;
  if (!routePaths.has(cronPath)) {
    problems.push(
      `vercel.json agenda ${cronPath}, mas não existe route.ts para esse caminho. ` +
        'O cron vai falhar com 404 em produção.',
    );
  }
}

for (const declaredPath of Object.keys(manual)) {
  if (!routePaths.has(declaredPath)) {
    problems.push(
      `cron-manual.json declara ${declaredPath}, que não existe mais. Remova a entrada.`,
    );
  }
}

if (process.argv.includes('--update')) {
  console.log('Rotas sem agenda (declare em cron-manual.json ou agende):');
  for (const route of routes) {
    if (!scheduled.has(route.path)) console.log(`  ${route.path}`);
  }
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

const manualCount = Object.keys(manual).length;

console.log(
  `✔ ${routes.length} rota(s) de cron: todas exportam GET; ` +
    `${routes.length - manualCount} agendada(s), ${manualCount} com disparo declarado.`,
);
for (const route of routes) {
  const where = scheduled.has(route.path) ? 'vercel.json' : 'cron-manual.json';
  console.log(`   ${route.path} → ${where}`);
}
