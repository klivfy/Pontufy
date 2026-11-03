import type { PrismaClient } from '@prisma/client';
import { prisma } from './db';

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT DE PLATAFORMA — acesso entre tenants. USE COM MEDO.
//
// Este é o único módulo autorizado a entregar um `PrismaClient` sem escopo de
// tenant. O nome é deliberadamente hostil: importar aqui é uma decisão
// consciente, revisável, e não um atalho.
//
// A regra "nunca use prisma direto para dado de tenant" existia apenas como
// convenção: não havia nada que impedisse a 37ª exceção. Agora há:
//   • a regra `no-restricted-syntax` em eslint.config.mjs bloqueia
//     `prisma.<modeloDeTenant>` em qualquer arquivo fora da allowlist;
//   • a allowlist está declarada lá, arquivo por arquivo, com justificativa.
//
// Casos legítimos (e por que o escopo de tenant não existe neles):
//   • pré-sessão — login, registro, convite, reset de senha: ainda não há
//     token de tenant para escopar (o e-mail é a chave, e é único global);
//   • jobs de plataforma — crons cruzam tenants por definição;
//   • webhooks — chegam sem sessão; a correlação é por trackingSubId;
//   • verificação pública de certificado — por design, sem sessão;
//   • bootstrap local (seed) e catálogo global de recompensas (tenantId null).
//
// Qualquer uso novo exige: (a) entrar na allowlist, (b) justificar aqui,
// (c) ser revisado por outra pessoa.
// ═══════════════════════════════════════════════════════════════════════════

export function getRawPrisma(): PrismaClient {
  return prisma;
}
