type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  tenantId?: string;
  meta?: Record<string, unknown>;
}

function emit(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>, tenantId?: string) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...(tenantId ? { tenantId } : {}),
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
  info: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('info', service, message, meta),
  warn: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('warn', service, message, meta),
  error: (message: string, meta?: Record<string, unknown>, service = 'app') =>
    emit('error', service, message, meta),
};

export function createLogger(tenantId: string, service: string) {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => emit('info', service, msg, meta, tenantId),
    warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', service, msg, meta, tenantId),
    error: (msg: string, meta?: Record<string, unknown>) => emit('error', service, msg, meta, tenantId),
  };
}
