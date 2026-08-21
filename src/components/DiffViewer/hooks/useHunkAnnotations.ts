import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIProviderConfig, DiffFile } from '../../../types';
import type { DiffHunk } from '../../../utils/diffParser';
import {
  isParsedPseudocodeUseful,
  parseAiPseudocodeLines,
} from '../../../utils/pseudocodeConverter';
import { streamExplainDiff } from '../../../services/api';
import { aiCache } from '../../../services/aiCache';
import { DEFAULT_PROMPTS } from '../../../constants/defaultPrompts';

export interface PseudocodeLines {
  dels: string[];
  adds: string[];
  loading: boolean;
  error?: string;
}

export interface NaturalLanguageEntry {
  text: string;
  loading: boolean;
}

/**
 * Owns every per-hunk AI annotation the viewer can show: in-place pseudocode
 * translation and the inline natural-language reading. Extracted from
 * DiffViewer so the component is left with rendering only.
 */
export function useHunkAnnotations(file: DiffFile | null, aiConfig: AIProviderConfig) {
  const [pseudocodeHunkIds, setPseudocodeHunkIds] = useState<Set<string>>(new Set());
  const [pseudocodeLines, setPseudocodeLines] = useState<Record<string, PseudocodeLines>>({});
  const [naturalHunkIds, setNaturalHunkIds] = useState<Set<string>>(new Set());
  const [naturalContent, setNaturalContent] = useState<Record<string, NaturalLanguageEntry>>({});

  /** Session-lifetime memo, so re-toggling a hunk never re-hits the network. */
  const translationCacheRef = useRef<Map<string, { dels: string[]; adds: string[] }>>(new Map());
  const abortsRef = useRef<Map<string, () => void>>(new Map());

  // Latest config without making every callback depend on its identity.
  const configRef = useRef(aiConfig);
  configRef.current = aiConfig;

  const filePath = file?.newPath;
  const fileDiff = file?.diff;

  const abortAll = useCallback(() => {
    abortsRef.current.forEach((abort) => abort());
    abortsRef.current.clear();
  }, []);

  // Switching files invalidates every per-hunk toggle and any request in flight.
  useEffect(() => {
    abortAll();
    setPseudocodeHunkIds(new Set());
    setNaturalHunkIds(new Set());
  }, [filePath, file?.oldPath, fileDiff, abortAll]);

  // Leaving the viewer entirely must not leave streams running.
  useEffect(() => abortAll, [abortAll]);

  const isAiEnabled = useCallback(
    () => Boolean(configRef.current.apiKey) || configRef.current.provider === 'ollama',
    []
  );

  const fetchPseudocode = useCallback(
    async (hunk: DiffHunk) => {
      if (!filePath) return;

      const config = configRef.current;
      const hunkId = hunk.id;
      const memoKey = `${filePath}::${hunkId}::${hunk.text.length}`;
      const persistentKey = aiCache.generateKey({
        type: 'pseudocode',
        filePath,
        diff: hunk.text,
        model: config.model,
      });

      const memoHit = translationCacheRef.current.get(memoKey);
      if (memoHit && isParsedPseudocodeUseful(memoHit)) {
        setPseudocodeLines((prev) => ({ ...prev, [hunkId]: { ...memoHit, loading: false } }));
        return;
      }

      const persisted = aiCache.get(persistentKey);
      if (persisted?.report) {
        const parsed = parseAiPseudocodeLines(persisted.report);
        if (isParsedPseudocodeUseful(parsed)) {
          translationCacheRef.current.set(memoKey, parsed);
          setPseudocodeLines((prev) => ({ ...prev, [hunkId]: { ...parsed, loading: false } }));
          return;
        }
        // Ignore cached error text / unparseable replies so a retry can succeed.
      }

      abortsRef.current.get(hunkId)?.();
      abortsRef.current.delete(hunkId);

      setPseudocodeLines((prev) => ({
        ...prev,
        [hunkId]: { dels: prev[hunkId]?.dels || [], adds: prev[hunkId]?.adds || [], loading: true },
      }));

      let accumulated = '';
      let renderedLineCount = 0;

      const cancel = await streamExplainDiff({
        sessionId: `hunk_pseudocode_${hunkId}`,
        scopeType: 'chunk',
        task: 'pseudocode',
        filePath,
        diff: hunk.text,
        userPrompt: config.pseudocodePrompt?.trim() || DEFAULT_PROMPTS.pseudocodePrompt,
        config,
        onChunk: (chunk) => {
          accumulated += chunk;
          // Re-render on line boundaries only: a partial line would render as
          // flickering half-translated pseudocode.
          const lineCount = countNewlines(accumulated);
          if (lineCount <= renderedLineCount) return;

          renderedLineCount = lineCount;
          const parsed = parseAiPseudocodeLines(accumulated);
          setPseudocodeLines((prev) => ({
            ...prev,
            [hunkId]: { ...parsed, loading: true },
          }));
        },
        onComplete: () => {
          abortsRef.current.delete(hunkId);
          const parsed = parseAiPseudocodeLines(accumulated);
          if (isParsedPseudocodeUseful(parsed)) {
            translationCacheRef.current.set(memoKey, parsed);
            aiCache.set(persistentKey, {
              report: accumulated,
              model: config.model,
              provider: config.provider,
            });
            setPseudocodeLines((prev) => ({
              ...prev,
              [hunkId]: { ...parsed, loading: false },
            }));
            return;
          }
          setPseudocodeLines((prev) => ({
            ...prev,
            [hunkId]: {
              dels: prev[hunkId]?.dels || [],
              adds: prev[hunkId]?.adds || [],
              loading: false,
              error: describePseudocodeFailure(accumulated),
            },
          }));
        },
        onError: (err) => {
          abortsRef.current.delete(hunkId);
          console.warn('AI pseudocode error:', err);
          setPseudocodeLines((prev) => ({
            ...prev,
            [hunkId]: {
              dels: prev[hunkId]?.dels || [],
              adds: prev[hunkId]?.adds || [],
              loading: false,
              error: describePseudocodeFailure('', err.message),
            },
          }));
        },
      });

      abortsRef.current.set(hunkId, cancel);
    },
    [filePath]
  );

  const ensurePseudocode = useCallback(
    (hunk: DiffHunk) => {
      if (!isAiEnabled()) {
        setPseudocodeLines((prev) => ({
          ...prev,
          [hunk.id]: {
            dels: prev[hunk.id]?.dels || [],
            adds: prev[hunk.id]?.adds || [],
            loading: false,
            error: '未配置 API Key。请在右上角「⚙️ AI 引擎配置」中填写后重试。',
          },
        }));
        return;
      }
      const existing = pseudocodeLines[hunk.id];
      const alreadyLoaded = isParsedPseudocodeUseful(existing || { dels: [], adds: [] });
      if (alreadyLoaded || existing?.loading) return;
      fetchPseudocode(hunk);
    },
    [fetchPseudocode, isAiEnabled, pseudocodeLines]
  );

  const togglePseudocode = useCallback(
    (hunk: DiffHunk) => {
      const hunkId = hunk.id;
      const isOn = pseudocodeHunkIds.has(hunkId);

      if (isOn && pseudocodeLines[hunkId]?.error) {
        fetchPseudocode(hunk);
        return;
      }

      if (isOn) {
        setPseudocodeHunkIds((prev) => {
          const next = new Set(prev);
          next.delete(hunkId);
          return next;
        });
        abortsRef.current.get(hunkId)?.();
        abortsRef.current.delete(hunkId);
        return;
      }

      setPseudocodeHunkIds((prev) => new Set(prev).add(hunkId));
      ensurePseudocode(hunk);
    },
    [ensurePseudocode, fetchPseudocode, pseudocodeHunkIds, pseudocodeLines]
  );

  const toggleAllPseudocode = useCallback(
    (hunks: DiffHunk[]) => {
      if (pseudocodeHunkIds.size > 0) {
        abortAll();
        setPseudocodeHunkIds(new Set());
        return;
      }
      setPseudocodeHunkIds(new Set(hunks.map((h) => h.id)));
      hunks.forEach(ensurePseudocode);
    },
    [abortAll, ensurePseudocode, pseudocodeHunkIds.size]
  );

  const toggleNaturalLanguage = useCallback(
    (hunk: DiffHunk) => {
      if (!filePath) return;
      const hunkId = hunk.id;

      if (naturalHunkIds.has(hunkId)) {
        setNaturalHunkIds((prev) => {
          const next = new Set(prev);
          next.delete(hunkId);
          return next;
        });
        return;
      }

      setNaturalHunkIds((prev) => new Set(prev).add(hunkId));

      const config = configRef.current;
      const persistentKey = aiCache.generateKey({
        type: 'natural_language',
        filePath,
        diff: hunk.text,
        model: config.model,
      });

      const cached = aiCache.get(persistentKey);
      if (cached?.report) {
        setNaturalContent((prev) => ({
          ...prev,
          [hunkId]: { text: cached.report, loading: false },
        }));
        return;
      }

      const existing = naturalContent[hunkId];
      if (existing?.text || existing?.loading) return;

      setNaturalContent((prev) => ({ ...prev, [hunkId]: { text: '', loading: true } }));

      let accumulated = '';

      streamExplainDiff({
        sessionId: `hunk_natural_${hunkId}`,
        scopeType: 'chunk',
        filePath,
        diff: hunk.text,
        task: 'natural_language',
        userPrompt: config.naturalLanguagePrompt?.trim() || DEFAULT_PROMPTS.naturalLanguagePrompt,
        config,
        onChunk: (chunk) => {
          accumulated += chunk;
          setNaturalContent((prev) => ({
            ...prev,
            [hunkId]: { text: accumulated, loading: true },
          }));
        },
        onComplete: () => {
          if (accumulated.trim()) {
            aiCache.set(persistentKey, {
              report: accumulated,
              model: config.model,
              provider: config.provider,
            });
          }
          setNaturalContent((prev) => ({
            ...prev,
            [hunkId]: { text: prev[hunkId]?.text || '', loading: false },
          }));
        },
        onError: (err) => {
          setNaturalContent((prev) => ({
            ...prev,
            [hunkId]: {
              text: (prev[hunkId]?.text || '') + `\n\n*(转译异常: ${err.message})*`,
              loading: false,
            },
          }));
        },
      });
    },
    [filePath, naturalContent, naturalHunkIds]
  );

  return {
    pseudocodeHunkIds,
    pseudocodeLines,
    naturalHunkIds,
    naturalContent,
    togglePseudocode,
    toggleAllPseudocode,
    toggleNaturalLanguage,
  };
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

function describePseudocodeFailure(raw: string, networkError?: string): string {
  if (networkError) {
    if (/Failed to fetch|ECONNREFUSED|NetworkError/i.test(networkError)) {
      return '后端未连接。请确认已运行 npm run dev，且 4000 端口的 API 服务已启动。';
    }
    return `伪代码生成失败：${networkError}`;
  }
  const text = raw.replace(/[#*`]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '伪代码生成失败：未收到模型输出。';
  if (text.includes('未检测到 API Key')) {
    return '未配置 API Key。请在右上角「⚙️ AI 引擎配置」中填写后重试。';
  }
  if (text.includes('大模型接口请求失败') || text.includes('请求连接失败')) {
    return text.slice(0, 240);
  }
  return '模型没有按 -/+ 伪代码格式输出，无法替换到 Diff 行上。请重试，或在设置里检查「概括伪代码」提示词。';
}
