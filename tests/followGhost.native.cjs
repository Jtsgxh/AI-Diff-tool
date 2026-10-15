const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const emptyTarget = 'package demo;\n\npublic class Empty {\n    private int id;\n    private int amount;\n\n    public int getId() {\n        return id;\n    }\n}\n';
const oldImport = 'import com.gameplus.service.dmx.DmxCatLogic;\n';
const newImport = 'import com.gameplus.service.activitypro.returncampaign.ReturnCampaignActivity;\n';

/** 在全新目录调用实际创建服务准备原生验收仓库，不使用用户正在跟写的文件。 */
async function prepare(root) {
  await fs.mkdir(root); // 已存在时失败，避免覆盖上一次结果或用户内容。
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  /** Git 仅操作本测试刚创建的参考仓库。 */
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '--quiet'); git('config', 'user.name', 'Native Follow Test'); git('config', 'user.email', 'native@example.test');
  await fs.writeFile(path.join(source, '.gitattributes'), '* text eol=lf\n');
  await fs.writeFile(path.join(source, 'Imports.java'), oldImport);
  await fs.writeFile(path.join(source, 'replace.ts'), 'const value = 1;\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(source, 'Empty.java'), emptyTarget);
  await fs.writeFile(path.join(source, 'Imports.java'), newImport + oldImport);
  await fs.writeFile(path.join(source, 'replace.ts'), 'const value = 2;\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'target');
  await require('esbuild').build({ entryPoints: ['server/followService.ts'], outfile: path.join(root, 'follow-service.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
  await require(path.join(root, 'follow-service.cjs')).createFollow(source, path.join(root, 'practice'), base, 'HEAD');
  await fs.mkdir(path.join(root, 'profile', 'User'), { recursive: true });
  await fs.writeFile(path.join(root, 'profile', 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false, 'editor.inlineSuggest.enabled': true, 'editor.quickSuggestions': false,
    'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
  }));
  await fs.mkdir(path.join(root, 'extensions'));
  console.log(root);
}

/** 在真正的扩展宿主执行打开、显示、输入与保存完成，不使用模拟的 VS Code 提供器。 */
exports.run = async () => {
  const vscode = require('vscode');
  const practice = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const root = path.dirname(practice);
  const checks = [];
  /** 等待跨进程虚影与保存后的刷新完成。 */
  const settle = () => new Promise(resolve => setTimeout(resolve, 1000));
  /** 对齐原生新文件默认换行，不把正常的 CRLF 处理误判为功能失败。 */
  const expected = (doc, text) => text.replace(/\n/g, doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
  /** 可选地等待外部截图驱动；正常运行时原生接受命令也必须验证候选确实可用。 */
  const checkpoint = async (name, editor) => {
    checks.push({ name, text: editor.document.getText(), file: editor.document.fileName });
    try { await fs.access(path.join(root, 'capture-enabled')); } catch { return; }
    await fs.writeFile(path.join(root, 'capture-request.json'), JSON.stringify({ name }));
    for (let i = 0; i < 150; i++) {
      try { await fs.access(path.join(root, `captured-${name}`)); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error(`Screenshot driver did not capture ${name}`);
  };
  try {
    await vscode.extensions.getExtension('jtsgxh.ai-diff-follow').activate();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Empty.java' });
    await settle();
    let editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), '');
    assert.equal(await fs.readFile(path.join(practice, 'Empty.java'), 'utf8'), '');
    await checkpoint('empty', editor);
    await vscode.commands.executeCommand('type', { text: 'package demo;\n' });
    await settle();
    assert.equal(editor.document.getText(), expected(editor.document, 'package demo;\n'));
    await checkpoint('typed-prefix', editor);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(editor.document.getText(), expected(editor.document, emptyTarget));
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Imports.java' });
    await settle();
    editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), expected(editor.document, oldImport));
    await checkpoint('imports', editor);
    await vscode.commands.executeCommand('type', { text: newImport });
    assert.equal(editor.document.getText(), expected(editor.document, newImport + oldImport));
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'replace.ts' });
    await settle();
    editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), expected(editor.document, 'const value = 1;\n'));
    await vscode.commands.executeCommand('deleteRight');
    await settle();
    assert.equal(editor.document.getText(), expected(editor.document, 'const value = ;\n'));
    await checkpoint('replacement', editor);
    await vscode.commands.executeCommand('type', { text: '2' });
    await vscode.commands.executeCommand('aiDiff.follow.finish');
    const session = JSON.parse(await fs.readFile(path.join(practice, '.git', 'ai-diff-follow.json'), 'utf8'));
    assert.equal(session.finished, true);
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: false, error: error.stack || String(error), checks }, null, 2));
    throw error;
  }
};

if (process.argv[2] === '--prepare') {
  prepare(path.resolve(process.argv[3])).catch(error => { console.error(error); process.exitCode = 1; });
}
