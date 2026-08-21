import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { gitService } from './gitService';
import { aiService } from './aiService';
import { DEMO_COMMITS, DEMO_DIFFS } from './demoRepoService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper to normalize path
function resolvePath(p?: string): string {
  if (!p || p === 'demo' || p === 'current') {
    return process.cwd();
  }
  return path.resolve(p);
}

// 1. Get Repo Basic Info
app.get('/api/repo/info', async (req, res) => {
  const repoPath = req.query.path as string;
  if (repoPath === 'demo') {
    return res.json({
      path: 'demo',
      name: 'demo-repository (Simulated Fork Client)',
      currentBranch: 'main',
      tracking: 'origin/main',
      ahead: 1,
      behind: 0,
      isClean: false,
      modifiedFilesCount: 2,
      branches: ['main', 'feature/auth-jwt', 'bugfix/memory-leak'],
      remotes: [{ name: 'origin', refs: { fetch: 'https://github.com/demo/repo.git', push: 'https://github.com/demo/repo.git' } }],
    });
  }

  try {
    const targetPath = resolvePath(repoPath);
    const info = await gitService.getRepoInfo(targetPath);
    res.json(info);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Get Commits with Branch DAG Topology info
app.get('/api/repo/commits', async (req, res) => {
  const repoPath = req.query.path as string;
  const limit = parseInt(req.query.limit as string, 10) || 100;

  if (repoPath === 'demo') {
    return res.json({ commits: DEMO_COMMITS });
  }

  try {
    const targetPath = resolvePath(repoPath);
    const commits = await gitService.getCommits(targetPath, limit);
    res.json({ commits });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Get Commit Diff
app.get('/api/repo/diff/commit', async (req, res) => {
  const repoPath = req.query.path as string;
  const hash = req.query.hash as string;

  if (!hash) {
    return res.status(400).json({ error: 'Commit hash is required' });
  }

  if (repoPath === 'demo') {
    const demoDiff = DEMO_DIFFS[hash] || {
      title: `Commit ${hash.slice(0, 7)}`,
      summary: { filesChanged: 1, insertions: 10, deletions: 4 },
      files: [
        {
          oldPath: 'src/demo.ts',
          newPath: 'src/demo.ts',
          status: 'modified',
          additions: 10,
          deletions: 4,
          diff: `diff --git a/src/demo.ts b/src/demo.ts\nindex 1234567..89abcdef 100644\n--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1,4 +1,10 @@\n-console.log("old");\n+console.log("new updated code");\n+// Added feature logic\n+export function demo() {\n+  return true;\n+}`,
        },
      ],
    };
    return res.json(demoDiff);
  }

  try {
    const targetPath = resolvePath(repoPath);
    const diff = await gitService.getCommitDiff(targetPath, hash);
    res.json(diff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Compare Two Commits / Branches
app.get('/api/repo/diff/compare', async (req, res) => {
  const repoPath = req.query.path as string;
  const base = req.query.base as string;
  const target = req.query.target as string;

  if (!base || !target) {
    return res.status(400).json({ error: 'Both base and target are required for comparison' });
  }

  if (repoPath === 'demo') {
    return res.json({
      title: `Compare ${base.slice(0, 7)}...${target.slice(0, 7)}`,
      summary: { filesChanged: 2, insertions: 42, deletions: 12 },
      files: [
        {
          oldPath: 'src/config.ts',
          newPath: 'src/config.ts',
          status: 'modified',
          additions: 12,
          deletions: 2,
          diff: `diff --git a/src/config.ts b/src/config.ts\nindex 111..222 100644\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -5,2 +5,12 @@\n-export const TIMEOUT = 3000;\n+export const TIMEOUT = 5000;\n+export const RETRY_ATTEMPTS = 3;\n+export const ENABLE_AI_STREAMING = true;`,
        },
      ],
    });
  }

  try {
    const targetPath = resolvePath(repoPath);
    const diff = await gitService.getCompareDiff(targetPath, base, target);
    res.json(diff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Working Tree Diff (Uncommitted changes)
app.get('/api/repo/diff/working-tree', async (req, res) => {
  const repoPath = req.query.path as string;

  if (repoPath === 'demo') {
    return res.json({
      title: 'Uncommitted Changes (Working Tree)',
      summary: { filesChanged: 2, insertions: 15, deletions: 3 },
      files: [
        {
          oldPath: 'src/App.tsx',
          newPath: 'src/App.tsx',
          status: 'modified',
          additions: 10,
          deletions: 3,
          diff: `diff --git a/src/App.tsx b/src/App.tsx\nindex 1234567..89abcdef 100644\n--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -10,3 +10,10 @@\n-  return <div>Legacy Diff Viewer</div>;\n+  return (\n+    <div className="flex h-screen">\n+      <CommitGraph />\n+      <DiffViewer />\n+    </div>\n+  );`,
        },
      ],
    });
  }

  try {
    const targetPath = resolvePath(repoPath);
    const diff = await gitService.getWorkingTreeDiff(targetPath);
    res.json(diff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 6. AI Semantic Explanation Streaming Endpoint
app.post('/api/ai/explain/stream', async (req, res) => {
  try {
    const { diff, filePath, commitMessage, userPrompt, config } = req.body;
    if (!diff) {
      return res.status(400).json({ error: 'Diff content is required' });
    }

    await aiService.streamExplainDiff(
      {
        diff,
        filePath,
        commitMessage,
        userPrompt,
        config,
      },
      res
    );
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Git Semantic Server running at http://localhost:${PORT}`);
});
