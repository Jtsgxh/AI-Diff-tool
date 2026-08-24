import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffResult, RepoInfo, SelectionState } from '../types';
import {
  fetchBatchCommitsDiff,
  fetchCommitDiff,
  fetchCommits,
  fetchCompareDiff,
  fetchRepoInfo,
  fetchWorkingTreeDiff,
} from '../services/api';
import type { CommitNode } from '../types';
import { STORAGE_KEYS, storage } from '../constants/storage';

const MAX_RECENT_REPOS = 10;

/** Selections that do not identify anything to diff yet. */
function isResolvable(selection: SelectionState): boolean {
  switch (selection.type) {
    case 'commit':
      return Boolean(selection.commitHash);
    case 'compare':
      return Boolean(selection.baseHash && selection.targetHash);
    case 'working-tree':
      return true;
    case 'batch':
      return (selection.commitHashes?.length ?? 0) > 0;
    default:
      return false;
  }
}

function shouldKeepSelection(prev: SelectionState, commits: CommitNode[]): boolean {
  switch (prev.type) {
    case 'working-tree':
      return true;
    case 'commit':
      return Boolean(prev.commitHash && commits.some((c) => c.hash === prev.commitHash));
    case 'compare':
      return Boolean(
        prev.baseHash &&
          prev.targetHash &&
          commits.some((c) => c.hash === prev.baseHash) &&
          commits.some((c) => c.hash === prev.targetHash)
      );
    case 'batch':
      return (
        (prev.commitHashes?.length ?? 0) > 0 &&
        (prev.commitHashes || []).every((h) => commits.some((c) => c.hash === h))
      );
    default:
      return false;
  }
}

function loadDiffFor(repoPath: string, selection: SelectionState): Promise<DiffResult | null> {
  switch (selection.type) {
    case 'commit':
      return fetchCommitDiff(repoPath, selection.commitHash!);
    case 'compare':
      return fetchCompareDiff(repoPath, selection.baseHash!, selection.targetHash!);
    case 'working-tree':
      return fetchWorkingTreeDiff(repoPath);
    case 'batch':
      return fetchBatchCommitsDiff(repoPath, selection.commitHashes!);
    default:
      return Promise.resolve(null);
  }
}

/**
 * Repository state: metadata, commit list, the current selection, and the diff
 * it resolves to.
 */
export function useRepository() {
  const [repoPath, setRepoPath] = useState<string>(
    () => storage.get(STORAGE_KEYS.lastRepoPath) || 'current'
  );
  const [recentRepos, setRecentRepos] = useState<string[]>(() =>
    storage.getJson<string[]>(STORAGE_KEYS.recentRepos, [])
  );

  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [repositoryRevision, setRepositoryRevision] = useState(0);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [selection, setSelection] = useState<SelectionState>({ type: 'commit', commitHash: '' });
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  const [isLoadingRepo, setIsLoadingRepo] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  /** Monotonic token; only the newest in-flight diff request may set state. */
  const diffRequestIdRef = useRef(0);

  const addRecentRepo = useCallback((pathToAdd: string) => {
    if (pathToAdd === 'demo' || pathToAdd === 'current') return;
    setRecentRepos((prev) => {
      const updated = [pathToAdd, ...prev.filter((p) => p !== pathToAdd)].slice(
        0,
        MAX_RECENT_REPOS
      );
      storage.setJson(STORAGE_KEYS.recentRepos, updated);
      return updated;
    });
  }, []);

  const removeRecentRepo = useCallback((pathToRemove: string) => {
    setRecentRepos((prev) => {
      const updated = prev.filter((p) => p !== pathToRemove);
      storage.setJson(STORAGE_KEYS.recentRepos, updated);
      return updated;
    });
  }, []);

  const loadRepo = useCallback(
    async (path: string) => {
      setIsLoadingRepo(true);
      setRepoError(null);
      try {
        const [info, commitData] = await Promise.all([fetchRepoInfo(path), fetchCommits(path)]);
        setRepoInfo(info);
        setRepositoryRevision((value) => value + 1);
        setCommits(commitData.commits);

        storage.set(STORAGE_KEYS.lastRepoPath, path);
        if (info.path && info.path !== 'demo') {
          addRecentRepo(info.path);
        }

        setSelection((prev) => {
          if (shouldKeepSelection(prev, commitData.commits)) {
            // New object so the diff effect re-runs (the working tree is live).
            return { ...prev };
          }
          if (info.modifiedFilesCount > 0) return { type: 'working-tree' };
          return commitData.commits.length > 0
            ? { type: 'commit', commitHash: commitData.commits[0].hash }
            : { type: 'working-tree' };
        });
      } catch (err: any) {
        console.error(err);
        setRepoError(err.message || '无法加载该 Git 仓库');
      } finally {
        setIsLoadingRepo(false);
      }
    },
    [addRecentRepo]
  );

  useEffect(() => {
    loadRepo(repoPath);
  }, [repoPath, loadRepo]);

  useEffect(() => {
    if (!isResolvable(selection)) return;

    const requestId = ++diffRequestIdRef.current;
    setIsLoadingDiff(true);

    loadDiffFor(repoPath, selection)
      .then((res) => {
        // Clicking through commits quickly can land responses out of order;
        // anything but the latest request is discarded.
        if (requestId !== diffRequestIdRef.current) return;
        setDiffResult(res);
      })
      .catch((err) => {
        if (requestId !== diffRequestIdRef.current) return;
        console.error(err);
        setDiffResult(null);
      })
      .finally(() => {
        if (requestId !== diffRequestIdRef.current) return;
        setIsLoadingDiff(false);
      });
  }, [selection, repoPath]);

  const refresh = useCallback(() => loadRepo(repoPath), [loadRepo, repoPath]);

  return {
    repoPath,
    setRepoPath,
    recentRepos,
    removeRecentRepo,
    repoInfo,
    repositoryRevision,
    commits,
    selection,
    setSelection,
    diffResult,
    isLoadingRepo,
    isLoadingDiff,
    repoError,
    refresh,
  };
}
