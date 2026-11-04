// ═══════════════════════════════════════════════════════════════════════════
// Desenvolvimento local em um comando.
//
//   npm run dev:local
//
// Sobe o que a aplicação exige e que não existe nesta máquina:
//   1. stub do Upstash REST (o app fala o protocolo REST, não RESP — por isso
//      um Redis "de verdade" não serviria sem proxy);
//   2. `next dev`.
//
// O Postgres NÃO é iniciado aqui: assumimos que já está rodando (portátil em
// %TEMP%\pgportable na porta 5544). Se não estiver, o script avisa em vez de
// falhar com erro obscuro de conexão.
//
// NOTA DE PLATAFORMA: nada de `shell: true`. No Windows o executável do Node
// vive em "C:\Program Files\nodejs", e com shell o caminho sem aspas é cortado
// no primeiro espaço ("'C:\Program' não é reconhecido..."). Chamamos
// `process.execPath` e o binário do Next por caminho absoluto, com `shell: false`.
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const APP = process.cwd();
const PORT_APP = process.env.PORT ?? '3000';
const PORT_REDIS = process.env.LOCAL_REDIS_PORT ?? '8079';

const requireFromApp = createRequire(path.join(APP, 'package.json'));
const NEXT_BIN = path.join(
  path.dirname(requireFromApp.resolve('next/package.json')),
  'dist',
  'bin',
  'next',
);

/** Lê .env.local sem dependência (o Next carrega por conta própria). */
function loadEnvLocal() {
  try {
    for (const line of readFileSync(path.join(APP, '.env.local'), 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      if (!process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  } catch {
    // Sem .env.local seguimos com o ambiente do shell.
  }
}

loadEnvLocal();

const children = [];

function start(label, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: APP,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const prefix = `[${label}]`;
  child.stdout.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix} encerrou com código ${code}. Derrubando o resto.`);
      shutdown(code);
    }
  });

  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ── Pré-requisito: banco ───────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error(
    '\n[dev:local] DATABASE_URL ausente.\n' +
      'Suba o Postgres local e configure apps/pontufy/.env.local:\n' +
      '  DATABASE_URL="postgresql://postgres:senha@127.0.0.1:5544/pontufy"\n' +
      '  DIRECT_URL="postgresql://postgres:senha@127.0.0.1:5544/pontufy"\n',
  );
  process.exit(1);
}

console.log(`[dev:local] stub do Upstash em http://127.0.0.1:${PORT_REDIS}`);
start('redis', [path.join(APP, 'scripts', 'local-upstash.mjs'), PORT_REDIS]);

console.log(`[dev:local] aplicação em http://localhost:${PORT_APP}`);
console.log('[dev:local] Ctrl+C encerra os dois.\n');

start('app', [NEXT_BIN, 'dev', '--webpack', '-p', PORT_APP], {
  UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${PORT_REDIS}`,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? 'local-dev-token',
  AUTH_URL: `http://localhost:${PORT_APP}`,
  NEXTAUTH_URL: `http://localhost:${PORT_APP}`,
});
