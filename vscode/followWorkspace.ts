import fs from 'node:fs/promises';
import path from 'node:path';

/** 用 Git 元数据中的专用工作区保存跟写显示设置，避免修改受校验的项目文件。 */
export async function ensureFollowWorkspace(practiceRepo: string, vscodeVersion: string): Promise<string> {
  const metadata = path.join(practiceRepo, '.git');
  const directory = await fs.lstat(metadata);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('练习 Git 元数据目录无效。');
  const file = path.join(metadata, 'ai-diff-follow.code-workspace');
  const settings: Record<string, unknown> = {
    'editor.inlineSuggest.enabled': true,
    'editor.inlineSuggest.mode': 'subwordSmart',
    'editor.inlineSuggest.keepOnBlur': true,
    'editor.inlineSuggest.suppressSuggestions': true,
    'editor.inlineSuggest.suppressInSnippetMode': false,
  };
  const [major, minor] = vscodeVersion.split('.').map(Number);
  if (major > 1 || major === 1 && minor >= 138) settings['editor.inlineSuggest.experimental.showOnSuggestConflict'] = 'always';
  try {
    await fs.writeFile(file, `${JSON.stringify({ folders: [{ path: '..' }], settings }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // 用户可以调整专用工作区；再次进入时不覆盖已有配置，也不跟随链接打开其他路径。
    const existing = await fs.lstat(file);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('跟写工作区文件无效。');
  }
  return file;
}
