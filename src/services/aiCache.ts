/**
 * AI Multi-Level Persistent Caching Service (多级智能持久化缓存系统)
 * Provides instant 0ms recall for Codex reviews, Fast Diff explanations, and pseudocode.
 */

export interface CachedReviewItem {
  key: string;
  timestamp: number;
  report: string;
  toolEvents?: any[];
  chatHistory?: any[];
  model: string;
  provider: string;
  durationMs?: number;
  wordCount?: number;
}

class AICacheService {
  private memoryCache = new Map<string, CachedReviewItem>();
  private readonly STORAGE_PREFIX = 'git_ai_cache_';
  private readonly INDEX_KEY = 'git_ai_cache_index';

  constructor() {
    this.hydrateFromStorage();
  }

  // Simple string hash function for cache key generation
  generateKey(params: {
    type?: string;
    filePath?: string;
    diff?: string;
    targetLine?: string | number;
    userPrompt?: string;
    engineMode?: string;
    model?: string;
  }): string {
    const raw = `${params.engineMode || ''}::${params.type || ''}::${params.filePath || ''}::${
      params.targetLine || ''
    }::${params.userPrompt || ''}::${params.diff || ''}::${params.model || ''}`;
    
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return `cache_${Math.abs(hash).toString(36)}_${raw.length}`;
  }

  private hydrateFromStorage() {
    try {
      const indexRaw = localStorage.getItem(this.INDEX_KEY);
      if (!indexRaw) return;
      const keys: string[] = JSON.parse(indexRaw);

      keys.forEach((k) => {
        const itemRaw = localStorage.getItem(this.STORAGE_PREFIX + k);
        if (itemRaw) {
          try {
            const item: CachedReviewItem = JSON.parse(itemRaw);
            this.memoryCache.set(k, item);
          } catch {}
        }
      });
    } catch (e) {
      console.warn('Failed to hydrate AI cache from localStorage:', e);
    }
  }

  private persistKeys() {
    try {
      const keys = Array.from(this.memoryCache.keys()).slice(0, 100);
      localStorage.setItem(this.INDEX_KEY, JSON.stringify(keys));
    } catch {}
  }

  get(key: string): CachedReviewItem | null {
    const item = this.memoryCache.get(key);
    if (!item) return null;
    return item;
  }

  has(key: string): boolean {
    return this.memoryCache.has(key);
  }

  set(key: string, item: Omit<CachedReviewItem, 'key' | 'timestamp'>) {
    const fullItem: CachedReviewItem = {
      ...item,
      key,
      timestamp: Date.now(),
      wordCount: item.report?.length || 0,
    };

    this.memoryCache.set(key, fullItem);

    try {
      localStorage.setItem(this.STORAGE_PREFIX + key, JSON.stringify(fullItem));
      this.persistKeys();
    } catch (e) {
      // If quota exceeded, clear older entries
      this.pruneStorage();
    }
  }

  remove(key: string) {
    this.memoryCache.delete(key);
    try {
      localStorage.removeItem(this.STORAGE_PREFIX + key);
      this.persistKeys();
    } catch {}
  }

  clear() {
    this.memoryCache.clear();
    try {
      const indexRaw = localStorage.getItem(this.INDEX_KEY);
      if (indexRaw) {
        const keys: string[] = JSON.parse(indexRaw);
        keys.forEach((k) => localStorage.removeItem(this.STORAGE_PREFIX + k));
      }
      localStorage.removeItem(this.INDEX_KEY);
    } catch {}
  }

  private pruneStorage() {
    const entries = Array.from(this.memoryCache.entries());
    if (entries.length > 30) {
      const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, 15);
      toRemove.forEach(([k]) => this.remove(k));
    }
  }

  getCount(): number {
    return this.memoryCache.size;
  }
}

export const aiCache = new AICacheService();
