import path from 'path';

/**
 * Normalizes a user-supplied repository path. `current` (and an empty value)
 * mean "the directory the server was started in".
 */
export function resolveRepoPath(p?: string): string {
  if (!p || p === 'current') {
    return process.cwd();
  }
  const clean = p.trim().replace(/^["']|["']$/g, '');
  return path.resolve(clean);
}
