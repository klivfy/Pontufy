import { getRedis } from '@/infra/redis';

export async function acquireLock(key: string, ttlSeconds: number = 10): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const lockValue = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const acquired = await redis.set(`mutex:${key}`, lockValue, { nx: true, ex: ttlSeconds });
  return acquired === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const luaScript = `
    if redis.call("EXISTS", KEYS[1]) == 1 then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(luaScript, [`mutex:${key}`], []);
  } catch {
    await redis.del(`mutex:${key}`);
  }
}

export async function extendLock(key: string, additionalTtlSeconds: number = 10): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const luaScript = `
    if redis.call("EXISTS", KEYS[1]) == 1 then
      return redis.call("EXPIRE", KEYS[1], ARGV[1])
    else
      return 0
    end
  `;
  try {
    const result = await redis.eval(luaScript, [`mutex:${key}`], [additionalTtlSeconds.toString()]);
    return result === 1;
  } catch {
    return false;
  }
}
