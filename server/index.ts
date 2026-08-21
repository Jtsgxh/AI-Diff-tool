import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import { gitService } from './gitService';
import { aiService } from './aiService';
import { agentEngine } from './agentEngine';

const execPromise = util.promisify(exec);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper to normalize path
function resolvePath(p?: string): string {
  if (!p || p === 'current') {
    return process.cwd();
  }
  const clean = p.trim().replace(/^["']|["']$/g, '');
  return path.resolve(clean);
}

// 0. System Quick Paths (Home, Documents, Desktop, Drives)
app.get('/api/system/quick-paths', (req, res) => {
  try {
    const home = os.homedir();
    const shortcuts = [
      { name: '用户主目录 (Home)', path: home },
      { name: '文档 (Documents)', path: path.join(home, 'Documents') },
      { name: '桌面 (Desktop)', path: path.join(home, 'Desktop') },
      { name: '下载 (Downloads)', path: path.join(home, 'Downloads') },
      { name: '当前工程 (Workspace)', path: process.cwd() },
    ];

    // Find Windows drives if on Windows
    const drives: { name: string; path: string }[] = [];
    if (process.platform === 'win32') {
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      for (const letter of letters) {
        const driveRoot = `${letter}:\\`;
        try {
          if (fs.existsSync(driveRoot)) {
            drives.push({ name: `本地磁盘 (${letter}:)`, path: driveRoot });
          }
        } catch {
          // ignore inaccessible drive
        }
      }
    }

    res.json({ shortcuts, drives });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 0.1 Browse Directory Items
app.get('/api/system/browse', (req, res) => {
  try {
    const rawPath = (req.query.path as string) || os.homedir();
    const currentPath = resolvePath(rawPath);

    if (!fs.existsSync(currentPath)) {
      return res.status(404).json({ error: `路径不存在: ${currentPath}` });
    }

    const stat = fs.statSync(currentPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `不是有效的文件夹: ${currentPath}` });
    }

    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    const directories: { name: string; path: string; isGitRepo: boolean }[] = [];

    // Check if current directory itself is a git repo
    const isCurrentGitRepo = fs.existsSync(path.join(currentPath, '.git'));

    for (const item of items) {
      if (item.isDirectory()) {
        const itemFullPath = path.join(currentPath, item.name);
        let isGit = false;
        try {
          isGit = fs.existsSync(path.join(itemFullPath, '.git'));
        } catch {
          isGit = false;
        }

        // Filter out typical system/hidden noise unless relevant
        if (!item.name.startsWith('$') && item.name !== 'System Volume Information') {
          directories.push({
            name: item.name,
            path: itemFullPath,
            isGitRepo: isGit,
          });
        }
      }
    }

    // Sort: Git repos first, then alphabetically
    directories.sort((a, b) => {
      if (a.isGitRepo && !b.isGitRepo) return -1;
      if (!a.isGitRepo && b.isGitRepo) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const parentPath = path.dirname(currentPath);

    res.json({
      current: currentPath,
      parent: parentPath !== currentPath ? parentPath : null,
      currentPath,
      parentPath: parentPath !== currentPath ? parentPath : null,
      isCurrentGitRepo,
      directories: directories.slice(0, 150),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 0.2 System Native Folder Picker
app.post('/api/system/pick-folder', async (req, res) => {
  try {
    if (process.platform === 'win32') {
      const psCommand = `powershell -Sta -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowNewFolderButton = $false; $form = New-Object System.Windows.Forms.Form; $form.TopMost = $true; if ($f.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`;
      const { stdout } = await execPromise(psCommand, { timeout: 15000 });
      const selected = stdout.trim();
      if (selected) {
        return res.json({ path: selected });
      }
    }
    return res.json({ path: null });
  } catch (err: any) {
    res.json({ path: null, error: err.message });
  }
});

// 1. Get Repo Basic Info
app.get('/api/repo/info', async (req, res) => {
  const repoPath = req.query.path as string;

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

  try {
    const targetPath = resolvePath(repoPath);
    const diff = await gitService.getWorkingTreeDiff(targetPath);
    res.json(diff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5.5 Batch Multi-Commit Net Diff (Consolidated merge of multiple commits)
app.post('/api/repo/diff/batch', async (req, res) => {
  const { repoPath, commitHashes } = req.body;

  if (!commitHashes || !Array.isArray(commitHashes) || commitHashes.length === 0) {
    return res.status(400).json({ error: 'commitHashes array is required' });
  }

  try {
    const targetPath = resolvePath(repoPath);
    const diff = await gitService.getBatchCommitsDiff(targetPath, commitHashes);
    res.json(diff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Fast AI Semantic Explanation Streaming Endpoint
app.post('/api/ai/explain/stream', async (req, res) => {
  try {
    const { scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } = req.body;
    if (!diff && !targetLine) {
      return res.status(400).json({ error: 'Diff content or targetLine is required' });
    }

    await aiService.streamExplainDiff(
      {
        scopeType,
        targetLine,
        diff: diff || targetLine?.content || '',
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

// 7. Agentic Deep Codebase Exploration Streaming Endpoint
app.post('/api/ai/agent/explain/stream', async (req, res) => {
  try {
    const { repoPath, scopeType, targetLine, diff, filePath, commitMessage, userPrompt, config } =
      req.body;
    if (!diff && !targetLine) {
      return res.status(400).json({ error: 'Diff content or targetLine is required' });
    }

    const resolvedRepo = resolvePath(repoPath);

    await agentEngine.streamAgentExplain(
      {
        repoPath: resolvedRepo,
        scopeType,
        targetLine,
        diff: diff || targetLine?.content || '',
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
