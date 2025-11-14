import { RedisClient } from './RedisClient';
import { config } from '../../config';
import { logger } from '../logging/Logger';

export class RedisLockManager {
  private static instance: RedisLockManager;
  private redisClient: RedisClient;

  private constructor() {
    this.redisClient = RedisClient.getInstance();
  }

  public static getInstance(): RedisLockManager {
    if (!RedisLockManager.instance) {
      RedisLockManager.instance = new RedisLockManager();
    }
    return RedisLockManager.instance;
  }

  public async acquireLock(
    resourceId: string,
    identifier: string
  ): Promise<boolean> {
    const lockKey = `lock:${resourceId}`;
    const ttlMs = config.lock.ttlMs;

    try {
      const result = await this.redisClient
        .getClient()
        .set(lockKey, identifier, 'PX', ttlMs, 'NX');
      
      if (result === 'OK') {
        logger.debug(`Lock acquired for resource ${resourceId}`, { identifier });
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error acquiring lock', { resourceId, error });
      return false;
    }
  }

  public async releaseLock(
    resourceId: string,
    identifier: string
  ): Promise<boolean> {
    const lockKey = `lock:${resourceId}`;

    // Lua script to ensure we only delete the lock if we own it
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redisClient
        .getClient()
        .eval(script, 1, lockKey, identifier);
      
      const released = result === 1;
      if (released) {
        logger.debug(`Lock released for resource ${resourceId}`, { identifier });
      }
      return released;
    } catch (error) {
      logger.error('Error releasing lock', { resourceId, error });
      return false;
    }
  }

  public async withLock<T>(
    resourceId: string,
    callback: () => Promise<T>
  ): Promise<T> {
    const identifier = `${Date.now()}-${Math.random()}`;
    const maxRetries = config.lock.retryCount;
    const retryDelay = config.lock.retryDelayMs;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const acquired = await this.acquireLock(resourceId, identifier);

      if (acquired) {
        try {
          return await callback();
        } finally {
          await this.releaseLock(resourceId, identifier);
        }
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    throw new Error(
      `Failed to acquire lock for resource ${resourceId} after ${maxRetries} attempts`
    );
  }
}
