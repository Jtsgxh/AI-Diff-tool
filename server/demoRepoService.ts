import { CommitNode, DiffResult } from './gitService';

export const DEMO_COMMITS: CommitNode[] = [
  {
    hash: 'a9f8b1c4e2d3f5a6b7c8d9e0f1a2b3c4d5e6f7a8',
    shortHash: 'a9f8b1c',
    parents: ['b8e7a0b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7'],
    author: 'Alex Chen',
    authorEmail: 'alex.chen@antigravity.dev',
    date: '2026-08-21 10:15:00',
    message: 'feat(ai): Add streaming SSE AI semantic explanation engine',
    refs: ['HEAD -> main', 'origin/main'],
  },
  {
    hash: 'b8e7a0b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7',
    shortHash: 'b8e7a0b',
    parents: [
      'c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8',
      'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0',
    ],
    author: 'Elena Rostova',
    authorEmail: 'elena@antigravity.dev',
    date: '2026-08-21 09:30:20',
    message: 'Merge branch "feature/auth-jwt" into main',
    refs: [],
  },
  {
    hash: 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0',
    shortHash: 'f1e2d3c',
    parents: ['e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1'],
    author: 'Michael Zhang',
    authorEmail: 'michael.z@antigravity.dev',
    date: '2026-08-20 18:40:11',
    message: 'refactor(auth): Upgrade token verification to RS256 with key rotation',
    refs: ['feature/auth-jwt'],
  },
  {
    hash: 'e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1',
    shortHash: 'e0d9c8b',
    parents: ['c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8'],
    author: 'Michael Zhang',
    authorEmail: 'michael.z@antigravity.dev',
    date: '2026-08-20 16:12:05',
    message: 'feat(auth): Implement JWT token generation & refresh interceptor',
    refs: [],
  },
  {
    hash: 'c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8',
    shortHash: 'c7d6e5f',
    parents: ['d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7'],
    author: 'Sarah Lin',
    authorEmail: 'sarah.lin@antigravity.dev',
    date: '2026-08-20 14:05:44',
    message: 'fix(cache): Resolve race condition in LRU cache eviction and lock contention',
    refs: ['v1.2.0'],
  },
  {
    hash: 'd6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7',
    shortHash: 'd6c5b4a',
    parents: ['9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b'],
    author: 'Alex Chen',
    authorEmail: 'alex.chen@antigravity.dev',
    date: '2026-08-19 11:20:30',
    message: 'perf(diff): Implement virtualized row rendering and token diffing',
    refs: [],
  },
  {
    hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
    shortHash: '9a8b7c6',
    parents: [],
    author: 'Alex Chen',
    authorEmail: 'alex.chen@antigravity.dev',
    date: '2026-08-18 09:00:00',
    message: 'chore(init): Initial repository structure with Git viewer workspace',
    refs: ['v1.0.0'],
  },
];

export const DEMO_DIFFS: Record<string, DiffResult> = {
  a9f8b1c4e2d3f5a6b7c8d9e0f1a2b3c4d5e6f7a8: {
    title: 'feat(ai): Add streaming SSE AI semantic explanation engine',
    summary: { filesChanged: 2, insertions: 68, deletions: 12 },
    files: [
      {
        oldPath: 'src/services/aiService.ts',
        newPath: 'src/services/aiService.ts',
        status: 'modified',
        additions: 52,
        deletions: 10,
        diff: `diff --git a/src/services/aiService.ts b/src/services/aiService.ts
index e69de29..b283912 100644
--- a/src/services/aiService.ts
+++ b/src/services/aiService.ts
@@ -14,14 +14,56 @@ export interface ExplainRequest {
   modelConfig?: ModelConfig;
 }
 
-export async function explainDiff(request: ExplainRequest): Promise<string> {
-  const response = await fetch('/api/ai/explain', {
-    method: 'POST',
-    headers: { 'Content-Type': 'application/json' },
-    body: JSON.stringify(request)
-  });
-  const data = await response.json();
-  return data.explanation;
+export async function explainDiffStream(
+  request: ExplainRequest,
+  onChunk: (chunk: string) => void,
+  onComplete: () => void,
+  onError: (err: Error) => void
+) {
+  const abortController = new AbortController();
+  
+  try {
+    const response = await fetch('/api/ai/explain/stream', {
+      method: 'POST',
+      headers: {
+        'Content-Type': 'application/json',
+        'Accept': 'text/event-stream'
+      },
+      body: JSON.stringify(request),
+      signal: abortController.signal
+    });
+
+    if (!response.ok) {
+      throw new Error(\`AI service returned \${response.status}: \${response.statusText}\`);
+    }
+
+    const reader = response.body?.getReader();
+    if (!reader) throw new Error('ReadableStream not supported');
+
+    const decoder = new TextDecoder('utf-8');
+    let buffer = '';
+
+    while (true) {
+      const { done, value } = await reader.read();
+      if (done) break;
+
+      buffer += decoder.decode(value, { stream: true });
+      const lines = buffer.split('\\n');
+      buffer = lines.pop() || '';
+
+      for (const line of lines) {
+        if (line.startsWith('data: ')) {
+          const data = line.slice(6);
+          if (data === '[DONE]') {
+            onComplete();
+            return;
+          }
+          onChunk(data);
+        }
+      }
+    }
+    onComplete();
+  } catch (error) {
+    onError(error as Error);
+  }
 }`,
      },
      {
        oldPath: 'src/components/ExplainModal.tsx',
        newPath: 'src/components/ExplainModal.tsx',
        status: 'modified',
        additions: 16,
        deletions: 2,
        diff: `diff --git a/src/components/ExplainModal.tsx b/src/components/ExplainModal.tsx
index a123456..b789012 100644
--- a/src/components/ExplainModal.tsx
+++ b/src/components/ExplainModal.tsx
@@ -28,8 +28,22 @@ export function ExplainModal({ diff, isOpen, onClose }: ExplainModalProps) {
     setIsLoading(true);
     setStreamContent('');
 
-    const result = await explainDiff({ diff, promptType: 'comprehensive' });
-    setStreamContent(result);
-    setIsLoading(false);
+    await explainDiffStream(
+      { diff, promptType: 'comprehensive' },
+      (chunk) => {
+        setStreamContent((prev) => prev + chunk);
+        setIsLoading(false); // Switch from spinner to typing indicator on first byte
+      },
+      () => {
+        setIsGenerating(false);
+        setIsLoading(false);
+      },
+      (err) => {
+        setError(err.message);
+        setIsLoading(false);
+      }
+    );
   };
 
   return (`,
      },
    ],
  },
  c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8: {
    title: 'fix(cache): Resolve race condition in LRU cache eviction and lock contention',
    summary: { filesChanged: 1, insertions: 34, deletions: 15 },
    files: [
      {
        oldPath: 'src/utils/lruCache.ts',
        newPath: 'src/utils/lruCache.ts',
        status: 'modified',
        additions: 34,
        deletions: 15,
        diff: `diff --git a/src/utils/lruCache.ts b/src/utils/lruCache.ts
index c1b2a3d..f4e5d6c 100644
--- a/src/utils/lruCache.ts
+++ b/src/utils/lruCache.ts
@@ -10,18 +10,37 @@ export class AsyncLRUCache<K, V> {
   private head: Node<K, V> | null = null;
   private tail: Node<K, V> | null = null;
-  private isEvicting = false;
+  private rwMutex = new AsyncMutex();
 
   constructor(private capacity: number, private ttlMs: number = 60000) {}
 
-  async get(key: K): Promise<V | undefined> {
-    const node = this.cache.get(key);
-    if (!node) return undefined;
-    if (Date.now() - node.timestamp > this.ttlMs) {
-      this.cache.delete(key);
-      return undefined;
+  async get(key: K): Promise<V | undefined> {
+    const unlock = await this.rwMutex.lockRead();
+    try {
+      const node = this.cache.get(key);
+      if (!node) return undefined;
+
+      // Check TTL expiration
+      if (Date.now() - node.timestamp > this.ttlMs) {
+        // Upgrade to write lock for atomic cleanup
+        unlock();
+        await this.delete(key);
+        return undefined;
+      }
+
+      this.moveToHead(node);
+      return node.value;
+    } finally {
+      unlock();
     }
-    this.moveToHead(node);
-    return node.value;
   }
 
-  set(key: K, value: V): void {
+  async set(key: K, value: V): Promise<void> {
+    const unlock = await this.rwMutex.lockWrite();
+    try {
+      if (this.cache.has(key)) {
+        const existing = this.cache.get(key)!;
+        existing.value = value;
+        existing.timestamp = Date.now();
+        this.moveToHead(existing);
+        return;
+      }
+
+      if (this.cache.size >= this.capacity) {
+        this.evictTailAtomic();
+      }
+
+      const newNode: Node<K, V> = { key, value, timestamp: Date.now(), next: null, prev: null };
+      this.cache.set(key, newNode);
+      this.attachHead(newNode);
+    } finally {
+      unlock();
+    }
   }
 }`,
      },
    ],
  },
  f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0: {
    title: 'refactor(auth): Upgrade token verification to RS256 with key rotation',
    summary: { filesChanged: 1, insertions: 28, deletions: 8 },
    files: [
      {
        oldPath: 'src/middleware/auth.ts',
        newPath: 'src/middleware/auth.ts',
        status: 'modified',
        additions: 28,
        deletions: 8,
        diff: `diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts
index 7a8b9c0..1d2e3f4 100644
--- a/src/middleware/auth.ts
+++ b/src/middleware/auth.ts
@@ -5,12 +5,32 @@ import { Request, Response, NextFunction } from 'express';
-const SECRET = process.env.JWT_SECRET || 'insecure-default';
+import { JwksClient } from 'jwks-rsa';
+
+const jwksClient = new JwksClient({
+  jwksUri: process.env.JWKS_URI || 'https://auth.company.internal/.well-known/jwks.json',
+  cache: true,
+  cacheMaxAge: 86400000, // 24h
+  rateLimit: true,
+  jwksRequestsPerMinute: 10
+});
+
+async function getSigningKey(kid: string): Promise<string> {
+  const key = await jwksClient.getSigningKey(kid);
+  return key.getPublicKey();
+}
 
 export async function requireAuth(req: Request, res: Response, next: NextFunction) {
   const authHeader = req.headers.authorization;
   if (!authHeader?.startsWith('Bearer ')) {
     return res.status(401).json({ error: 'Missing or malformed Authorization header' });
   }
 
   const token = authHeader.slice(7);
   try {
-    const payload = jwt.verify(token, SECRET);
-    req.user = payload;
+    const decodedHeader = jwt.decode(token, { complete: true });
+    if (!decodedHeader || !decodedHeader.header.kid) {
+      throw new Error('Token header missing kid identifier');
+    }
+
+    const publicKey = await getSigningKey(decodedHeader.header.kid);
+    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
+    req.user = payload;
     next();
   } catch (err: any) {
     return res.status(401).json({ error: 'Invalid or expired JWT token', details: err.message });
   }
 }`,
      },
    ],
  },
};
