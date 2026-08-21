/**
 * Minimal insertion-ordered LRU. Backed by Map iteration order, which is
 * insertion order, so promoting an entry is a delete + re-set.
 */
export class LruCache<V> {
  private readonly store = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    if (!this.store.has(key)) return undefined;
    const value = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
