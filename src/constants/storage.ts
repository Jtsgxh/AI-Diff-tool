/**
 * Every localStorage key used by the app, in one place. These were previously
 * scattered as string literals across five components, so a rename in one file
 * silently orphaned the data written by another.
 */
export const STORAGE_KEYS = {
  lastRepoPath: 'git_last_repo_path',
  recentRepos: 'git_recent_repos',
  aiConfig: 'git_ai_config',
  sidebarCollapsed: 'git_sidebar_collapsed',
  explanationOpen: 'git_ai_explanation_open',
  activeSessions: 'git_ai_active_sessions',
  activeSessionId: 'git_ai_active_session_id',
  aiCacheIndex: 'git_ai_cache_index',
  aiCachePrefix: 'git_ai_cache_',
} as const;

/**
 * localStorage throws in private-mode Safari and when the quota is exhausted,
 * and a single unguarded read can take down the whole render. Every access
 * goes through these helpers instead.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to do — the entry is unreachable either way.
    }
  },

  getJson<T>(key: string, fallback: T): T {
    const raw = storage.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  setJson(key: string, value: unknown): boolean {
    try {
      return storage.set(key, JSON.stringify(value));
    } catch {
      return false;
    }
  },
};
