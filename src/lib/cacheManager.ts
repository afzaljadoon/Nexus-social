interface CacheEntry<T> {
  data: T;
  expiry: number;
  tags: string[];
}

class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();

  /**
   * Stores an item in the in-memory cache.
   * @param key Unique key for the cache entry
   * @param data The payload to cache
   * @param ttlMs Time-To-Live in milliseconds
   * @param tags Semantic tags to associate with this entry for bulk invalidation
   */
  set<T>(key: string, data: T, ttlMs: number, tags: string[] = []): void {
    const expiry = Date.now() + ttlMs;
    this.cache.set(key, { data, expiry, tags });
    console.debug(`[CacheManager] SET: "${key}" (TTL: ${ttlMs / 1000}s, Tags: ${tags.join(', ')})`);
  }

  /**
   * Retrieves an item from the cache. Returns null if it doesn't exist or has expired.
   * @param key Cache key
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      console.debug(`[CacheManager] MISS: "${key}" (Not found)`);
      return null;
    }

    if (Date.now() > entry.expiry) {
      console.debug(`[CacheManager] EXPIRED: "${key}" (Cleaned up)`);
      this.cache.delete(key);
      return null;
    }

    console.debug(`[CacheManager] HIT: "${key}"`);
    return entry.data;
  }

  /**
   * Invalidates any cache entries associated with one or more of the specified tags.
   * @param tags Array of tags to invalidate
   */
  invalidateByTags(tags: string[]): void {
    if (tags.length === 0) return;
    
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      const match = entry.tags.some((t) => tags.includes(t));
      if (match) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      console.info(`[CacheManager] INVALIDATED ${count} entries by tags: [${tags.join(', ')}]`);
    }
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
    console.info('[CacheManager] Cache cleared entirely.');
  }

  /**
   * Returns all keys currently in the cache.
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

export const cacheManager = new CacheManager();
