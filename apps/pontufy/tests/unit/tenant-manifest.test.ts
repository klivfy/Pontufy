import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Manifesto de isolamento por tenant
//
// O interceptor `getTenantDb` só escopa os modelos listados em
// `STRICT_TENANT_MODELS`. Um modelo criado depois — com coluna `tenantId` —
// fica de fora e passa a vazar entre tenants SEM erro nenhum.
//
// Foi exatamente o que aconteceu com `FeatureFlag`: a leitura da flag do tenant
// beta devolveu a do alpha. O bug não apareceu em nenhum gate porque nada
// relacionava "modelo tem tenantId" com "modelo está protegido".
//
// Este teste faz essa relação. Se ele falhar, a correção é adicionar o modelo
// em `STRICT_TENANT_MODELS` (ou justificar a exceção na lista abaixo).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Modelos com `tenantId` que NÃO são escopados de propósito.
 * Cada exceção precisa de motivo escrito — é a diferença entre decisão e
 * esquecimento.
 */
const EXCECOES_INTENCIONAIS: Record<string, string> = {
  Tenant: 'é o próprio tenant; escopar por tenantId não faria sentido',
  Reward: 'modelo híbrido: recompensa global (tenantId null) precisa ser visível a todos',
  ProvisioningQuota: 'contador global por dia (não tem tenantId)',
};

const RAIZ = path.resolve(process.cwd(), '..', '..');
const SCHEMA = path.join(RAIZ, 'apps', 'pontufy', 'prisma', 'schema.prisma');
const DB_SOURCE = path.join(RAIZ, 'apps', 'pontufy', 'src', 'infra', 'db.ts');

/** Nomes de modelos declarados no schema. */
function modelosDoSchema(): string[] {
  const schema = readFileSync(SCHEMA, 'utf8');
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/** Modelos que possuem a coluna `tenantId`. */
function modelosComTenantId(): string[] {
  const schema = readFileSync(SCHEMA, 'utf8');
  const blocos = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];

  return blocos
    .filter(([, , corpo]) => /^\s+tenantId\s+String/m.test(corpo))
    .map(([, nome]) => nome);
}

/** Entradas de STRICT_TENANT_MODELS declaradas em db.ts. */
function modelosEscopados(): string[] {
  const source = readFileSync(DB_SOURCE, 'utf8');
  const bloco = /const STRICT_TENANT_MODELS = \[([\s\S]*?)\] as const;/.exec(source);
  assert.ok(bloco, 'STRICT_TENANT_MODELS não encontrado em src/infra/db.ts');

  return [...bloco[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
}

test('todo modelo com tenantId está em STRICT_TENANT_MODELS (ou justificado)', () => {
  const escopados = new Set(modelosEscopados());
  const comTenant = modelosComTenantId().filter((nome) => !EXCECOES_INTENCIONAIS[nome]);
  const desprotegidos = comTenant.filter((nome) => !escopados.has(nome));

  assert.deepEqual(
    desprotegidos,
    [],
    `Modelo(s) com tenantId fora do interceptor: ${desprotegidos.join(', ')}.\n` +
      'Adicione em STRICT_TENANT_MODELS (src/infra/db.ts) — sem isso, o getTenantDb ' +
      'não escopa a query e os dados vazam entre tenants.',
  );
});

test('STRICT_TENANT_MODELS não lista modelo inexistente', () => {
  const existentes = new Set(modelosDoSchema());
  const fantasmas = modelosEscopados().filter((nome) => !existentes.has(nome));

  assert.deepEqual(fantasmas, [], `STRICT_TENANT_MODELS cita modelo inexistente: ${fantasmas.join(', ')}`);
});

test('controle: o schema realmente tem modelos com tenantId', () => {
  // Se a extração quebrar (mudança de formato do schema), os testes acima
  // passariam vazios. Este garante que a varredura está funcionando.
  const comTenant = modelosComTenantId();
  assert.ok(comTenant.length >= 15, `esperado 15+ modelos com tenantId, encontrado ${comTenant.length}`);
});
