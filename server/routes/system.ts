import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { asyncHandler, badRequest, notFound } from '../http/errors';
import { resolveRepoPath } from '../utils/paths';
import { isGitRepository } from '../gitService';

const execPromise = util.promisify(exec);

/** Cap on directory entries returned to the browser picker. */
const MAX_BROWSE_ENTRIES = 150;
const FOLDER_PICKER_TIMEOUT_MS = 15000;

export const systemRouter = Router();

/** Home / Documents / Desktop / drives, for the repository picker sidebar. */
systemRouter.get('/quick-paths', (_req, res) => {
  const home = os.homedir();
  const shortcuts = [
    { name: '用户主目录 (Home)', path: home },
    { name: '文档 (Documents)', path: path.join(home, 'Documents') },
    { name: '桌面 (Desktop)', path: path.join(home, 'Desktop') },
    { name: '下载 (Downloads)', path: path.join(home, 'Downloads') },
    { name: '当前工程 (Workspace)', path: process.cwd() },
  ];

  const drives: { name: string; path: string }[] = [];
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const driveRoot = `${letter}:\\`;
      try {
        if (fs.existsSync(driveRoot)) {
          drives.push({ name: `本地磁盘 (${letter}:)`, path: driveRoot });
        }
      } catch {
        // Inaccessible drive (disconnected network share, locked device).
      }
    }
  }

  res.json({ shortcuts, drives });
});

/** Lists sub-directories of a path, surfacing git repositories first. */
systemRouter.get('/browse', asyncHandler(async (req, res) => {
  const currentPath = resolveRepoPath((req.query.path as string) || os.homedir());

  if (!fs.existsSync(currentPath)) {
    throw notFound(`路径不存在: ${currentPath}`);
  }
  if (!fs.statSync(currentPath).isDirectory()) {
    throw badRequest(`不是有效的文件夹: ${currentPath}`);
  }

  const items = fs.readdirSync(currentPath, { withFileTypes: true });
  const directories: { name: string; path: string; isGitRepo: boolean }[] = [];

  for (const item of items) {
    if (!item.isDirectory()) continue;
    // Skip Windows system noise that can never be a repository.
    if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;

    const itemFullPath = path.join(currentPath, item.name);
    directories.push({ name: item.name, path: itemFullPath, isGitRepo: false });
  }

  const isCurrentGitRepoPromise = isGitRepository(currentPath);
  await Promise.all(
    directories.map(async (directory) => {
      // Only repository roots have a .git marker. Git performs the final validation,
      // so empty/stale markers are not advertised as repositories.
      if (!fs.existsSync(path.join(directory.path, '.git'))) return;
      directory.isGitRepo = await isGitRepository(directory.path);
    })
  );

  directories.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const parentPath = path.dirname(currentPath);
  const parent = parentPath !== currentPath ? parentPath : null;

  res.json({
    current: currentPath,
    parent,
    currentPath,
    parentPath: parent,
    isCurrentGitRepo: await isCurrentGitRepoPromise,
    directories: directories.slice(0, MAX_BROWSE_ENTRIES),
  });
}));

/** Native folder dialog. Windows-only; other platforms fall back to /browse. */
systemRouter.post(
  '/pick-folder',
  asyncHandler(async (_req, res) => {
    if (process.platform !== 'win32') {
      return res.json({ path: null });
    }

    try {
      const psCommand = `powershell -Sta -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowNewFolderButton = $false; $form = New-Object System.Windows.Forms.Form; $form.TopMost = $true; if ($f.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`;
      const { stdout } = await execPromise(psCommand, { timeout: FOLDER_PICKER_TIMEOUT_MS });
      const selected = stdout.trim();
      return res.json({ path: selected || null });
    } catch (err: any) {
      // A cancelled or timed-out dialog is not an error worth failing the request over.
      return res.json({ path: null, error: err.message });
    }
  })
);
