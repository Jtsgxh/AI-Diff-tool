import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { isGitRepository } from '../server/gitService';

function makeTempDirectory(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'git-semantic-repo-detection-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('rejects an empty .git marker directory', async (t) => {
  const directory = makeTempDirectory(t);
  fs.mkdirSync(path.join(directory, '.git'));

  assert.equal(await isGitRepository(directory), false);
});

test('accepts a repository initialized by Git', async (t) => {
  const directory = makeTempDirectory(t);
  execFileSync('git', ['init', '--quiet', directory]);

  assert.equal(await isGitRepository(directory), true);
});
