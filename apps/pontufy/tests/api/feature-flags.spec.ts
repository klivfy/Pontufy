import { test, expect } from '@playwright/test';
import { prisma } from '../helpers/db';
import {
  clearFlagCache,
  isEnabled,
  isFlagKeyValid,
  listFlags,
  normalizeFlagKey,
  setFlag,
} from '../../src/domain/flags';

// ═══════════════════════════════════════════════════════════════════════════
// C4 — Feature flags
//
// O ponto crítico: flag AUSENTE devolve o padrão do call site, não `false`
// cego. Esquecer de cadastrar a flag não pode mudar o produto em silêncio.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = 'tenant-alpha-001';
const KEY = 'test.flag.c4';

test.describe('C4 — feature flags', () => {
  test.beforeEach(async () => {
    clearFlagCache();
    await prisma.featureFlag.deleteMany({ where: { key: { startsWith: 'test.flag' } } });
  });

  test.afterAll(async () => {
    clearFlagCache();
    await prisma.featureFlag.deleteMany({ where: { key: { startsWith: 'test.flag' } } });
  });

  test('chave é normalizada e validada no formato dominio.recurso', () => {
    expect(normalizeFlagKey('  AI.Review  ')).toBe('ai.review');
    expect(isFlagKeyValid('ai.review')).toBe(true);
    expect(isFlagKeyValid('ai.review-v2')).toBe(true);
    expect(isFlagKeyValid('sem_ponto')).toBe(false);
    expect(isFlagKeyValid('.comeca.com.ponto')).toBe(false);
  });

  test('flag ausente devolve o padrão do call site', async () => {
    expect(await isEnabled(TENANT, KEY)).toBe(false);
    expect(await isEnabled(TENANT, KEY, true)).toBe(true);
  });

  test('ligar e desligar reflete no banco e invalida o cache', async () => {
    await setFlag(TENANT, KEY, true);
    expect(await isEnabled(TENANT, KEY)).toBe(true);

    await setFlag(TENANT, KEY, false);
    expect(await isEnabled(TENANT, KEY)).toBe(false);
  });

  test('cache evita leitura repetida, mas setFlag invalida na hora', async () => {
    await setFlag(TENANT, KEY, true);
    expect(await isEnabled(TENANT, KEY)).toBe(true);

    // Altera direto no banco: o cache ainda responde o valor antigo.
    await prisma.featureFlag.update({
      where: { tenantId_key: { tenantId: TENANT, key: KEY } },
      data: { enabled: false },
    });
    expect(await isEnabled(TENANT, KEY), 'cache deve servir por até 60s').toBe(true);

    // setFlag limpa a entrada do processo.
    await setFlag(TENANT, KEY, false);
    expect(await isEnabled(TENANT, KEY)).toBe(false);
  });

  test('flag de um tenant não vaza para outro', async () => {
    await setFlag(TENANT, KEY, true);
    clearFlagCache();

    expect(await isEnabled(TENANT, KEY)).toBe(true);
    expect(await isEnabled('tenant-beta-001', KEY)).toBe(false);
  });

  test('kill switch por ambiente desliga o mecanismo', async () => {
    await setFlag(TENANT, KEY, true);
    clearFlagCache();

    process.env.FEATURE_FLAGS_DISABLED = '1';
    try {
      expect(await isEnabled(TENANT, KEY)).toBe(false);
      expect(await isEnabled(TENANT, KEY, true)).toBe(true);
    } finally {
      delete process.env.FEATURE_FLAGS_DISABLED;
    }
  });

  test('listFlags devolve as flags do tenant em ordem', async () => {
    await setFlag(TENANT, 'test.flag.b', true);
    await setFlag(TENANT, 'test.flag.a', false);

    const flags = (await listFlags(TENANT)).filter((f) => f.key.startsWith('test.flag'));
    expect(flags.map((f) => f.key)).toEqual(['test.flag.a', 'test.flag.b']);
  });
});
