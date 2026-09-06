/**
 * A small in-memory cache with a fixed TTL and in-flight de-duplication.
 *
 * The availability endpoint is public and proxies to Google, so a single
 * visitor flipping through months — or a link doing the rounds — can produce a
 * burst of identical calls. Caching the *promise* rather than the resolved
 * value means concurrent callers share one request instead of racing to make
 * the same one.
 *
 * Failures are never cached: a transient Google error should not be replayed
 * for the rest of the TTL.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: Promise<T>; expiresAt: number }>();

  constructor(private ttlMs: number) {}

  async wrap(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const value = factory();
    const entry = { value, expiresAt: now + this.ttlMs };
    this.entries.set(key, entry);
    value.catch(() => {
      // Only evict our own entry; a later call may already have replaced it.
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
    });

    this.prune(now);
    return value;
  }

  clear() {
    this.entries.clear();
  }

  /** Drops every entry whose key starts with `prefix`. */
  deleteByPrefix(prefix: string) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  /** Drops expired entries so a long-lived process cannot grow without bound. */
  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
