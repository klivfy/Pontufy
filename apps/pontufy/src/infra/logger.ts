import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  requestId?: string;
  tenantId?: string;
  meta?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// B1 — Observabilidade: requestId propagado + nível mínimo configurável
//
// Antes: cada log era uma linha JSON sem correlação. Um erro reportado pelo
// cliente chegava como "Erro interno." e não havia como achar as linhas
// daquela requisição no log. Agora `withRequestContext` abre um escopo
// (AsyncLocalStorage) e tudo que for logado dentro dele carrega o mesmo
// `requestId`, inclusive em chamadas assíncronas aninhadas.
//
// `LOG_LEVEL` filtra o volume. Padrão `info`; `debug` só sob demanda — em
// produção o volume de log é cobrado pela plataforma.
// ═══════════════════════════════════════════════════════════════════════════

interface RequestContext {
  requestId: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  return configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error'
    ? configured
    : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[minLevel()];
}

/** Executa `fn` com um contexto de requisição (id vindo do proxy ou gerado). */
export function withRequestContext<T>(context: Partial<RequestContext>, fn: () => T): T {
  const current = storage.getStore();
  return storage.run(
    {
      requestId: context.requestId ?? current?.requestId ?? randomUUID(),
      tenantId: context.tenantId ?? current?.tenantId,
    },
    fn,
  );
}

/** Id da requisição em curso (undefined fora de um escopo). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Associa o tenant ao contexto atual (após a autenticação). */
export function setContextTenant(tenantId: string): void {
  const current = storage.getStore();
  if (current) current.tenantId = tenantId;
}

function emit(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>, tenantId?: string) {
  if (!shouldLog(level)) return;

  const context = storage.getStore();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(tenantId ?? context?.tenantId ? { tenantId: tenantId ?? context?.tenantId } : {}),
    ...(meta ? { meta } : {}),
  };

  const line = JSON.stringify(entry);
  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

/** Logger único da aplicação. Use em vez de console.* em rotas e ações. */
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('debug', service, message, meta),
  info: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('info', service, message, meta),
  warn: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('warn', service, message, meta),
  error: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('error', service, message, meta),
};

export function createLogger(tenantId: string, service: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', service, msg, meta, tenantId),
    info: (msg: string, meta?: Record<string, unknown>) => emit('info', service, msg, meta, tenantId),
    warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', service, msg, meta, tenantId),
    error: (msg: string, meta?: Record<string, unknown>) => emit('error', service, msg, meta, tenantId),
  };
}