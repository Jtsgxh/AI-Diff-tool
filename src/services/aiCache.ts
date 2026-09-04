import { STORAGE_KEYS, storage } from '../constants/storage';

/**
 * Persistent cache for AI output (Codex reviews, fast-diff explanations,
 * pseudocode, natural-language readings) so revisiting a hunk is instant.
 */
export interface CachedReviewItem {
  key: string;
  timestamp: number;
  report: string;
  toolEvents?: any[];
  chatHistory?: any[];
  reasoning?: string;
  model: string;
  provider: string;
  durationMs?: number;
  wordCount?: number;
}

/** Entries beyond this are dropped from the index, oldest first. */
const MAX_ENTRIES = 100;
/** How many entries a quota-exceeded prune reclaims in one pass. */
const PRUNE_BATCH = 15;
/** Delay before the key index is rewritten, to coalesce bursts of writes. */
const INDEX_PERSIST_DEBOUNCE_MS = 300;

class AICacheService {
  /** Values actually parsed so far. Populated lazily. */
  private readonly memoryCache = new Map<string, CachedReviewItem>();
  /** Every key known to be on disk, newest first. */
  private index: string[] = [];
  private readonly indexSet = new Set<string>();
  private persistHandle: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Only the key list is read at startup. Deserializing every cached report
    // here used to block the first paint with up to 100 JSON.parse calls over
    // multi-kilobyte markdown documents.
    this.index = storage.getJson<string[]>(STORAGE_KEYS.aiCacheIndex, []);
    if (!Array.isArray(this.index)) this.index = [];
    this.index.forEach((k) => this.indexSet.add(k));
  }

  /** Stable 32-bit hash of the request shape; identical inputs reuse an entry. */
  generateKey(params: {
    type?: string;
    filePath?: string;
    diff?: string;
    targetLine?: string | number;
    userPrompt?: string;
    engineMode?: string;
    model?: string;
    agentMaxTurns?: number | null;
  }): string {
    const agentTurns =
      params.agentMaxTurns === undefined
        ? ''
        : `::agent-turns=${params.agentMaxTurns === null ? 'unlimited' : params.agentMaxTurns}`;
    const raw = `${params.engineMode || ''}::${params.type || ''}::${params.filePath || ''}::${
      params.targetLine || ''
    }::${params.userPrompt || ''}::${params.diff || ''}::${params.model || ''}${agentTurns}`;

    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0; // Force 32-bit integer arithmetic.
    }
    return `cache_${Math.abs(hash).toString(36)}_${raw.length}`;
  }

  get(key: string): CachedReviewItem | null {
    const memoryHit = this.memoryCache.get(key);
    if (memoryHit) return memoryHit;
    if (!this.indexSet.has(key)) return null;

    // Deferred deserialization: pay the parse cost only for entries actually read.
    const item = storage.getJson<CachedReviewItem | null>(
      STORAGE_KEYS.aiCachePrefix + key,
      null
    );
    if (!item) {
      this.dropFromIndex(key);
      return null;
    }

    this.memoryCache.set(key, item);
    return item;
  }

  has(key: string): boolean {
    return this.memoryCache.has(key) || this.indexSet.has(key);
  }

  set(key: string, item: Omit<CachedReviewItem, 'key' | 'timestamp'>): void {
    const fullItem: CachedReviewItem = {
      ...item,
      key,
      timestamp: Date.now(),
      wordCount: item.report?.length || 0,
    };

    this.memoryCache.set(key, fullItem);
    this.addToIndex(key);

    if (!storage.setJson(STORAGE_KEYS.aiCachePrefix + key, fullItem)) {
      // Quota exhausted — reclaim space and retry once.
      this.pruneStorage();
      storage.setJson(STORAGE_KEYS.aiCachePrefix + key, fullItem);
    }
    this.schedulePersistIndex();
  }

  remove(key: string): void {
    this.memoryCache.delete(key);
    this.dropFromIndex(key);
    storage.remove(STORAGE_KEYS.aiCachePrefix + key);
    this.schedulePersistIndex();
  }

  clear(): void {
    this.memoryCache.clear();
    this.index.forEach((k) => storage.remove(STORAGE_KEYS.aiCachePrefix + k));
    this.index = [];
    this.indexSet.clear();
    storage.remove(STORAGE_KEYS.aiCacheIndex);
  }

  getCount(): number {
    return this.indexSet.size;
  }

  private addToIndex(key: string): void {
    if (this.indexSet.has(key)) {
      this.index = this.index.filter((k) => k !== key);
    }
    this.index.unshift(key);
    this.indexSet.add(key);

    while (this.index.length > MAX_ENTRIES) {
      const evicted = this.index.pop();
      if (evicted === undefined) break;
      this.indexSet.delete(evicted);
      this.memoryCache.delete(evicted);
      storage.remove(STORAGE_KEYS.aiCachePrefix + evicted);
    }
  }

  private dropFromIndex(key: string): void {
    if (!this.indexSet.delete(key)) return;
    this.index = this.index.filter((k) => k !== key);
  }

  /** Drops the oldest entries; the index is newest-first, so that is the tail. */
  private pruneStorage(): void {
    const victims = this.index.slice(-PRUNE_BATCH);
    victims.forEach((k) => {
      this.indexSet.delete(k);
      this.memoryCache.delete(k);
      storage.remove(STORAGE_KEYS.aiCachePrefix + k);
    });
    this.index = this.index.slice(0, Math.max(0, this.index.length - victims.length));
    this.persistIndex();
  }

  private schedulePersistIndex(): void {
    if (this.persistHandle !== null) return;
    this.persistHandle = setTimeout(() => {
      this.persistHandle = null;
      this.persistIndex();
    }, INDEX_PERSIST_DEBOUNCE_MS);
  }

  private persistIndex(): void {
    storage.setJson(STORAGE_KEYS.aiCacheIndex, this.index);
  }
}

export const aiCache = new AICacheService();
