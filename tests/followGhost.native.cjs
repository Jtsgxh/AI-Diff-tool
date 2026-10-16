const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const emptyTarget = 'package demo;\n\npublic class Empty {\n    private int id;\n    private int amount;\n\n    public int getId() {\n        return id;\n    }\n}\n';
const oldImport = 'import com.gameplus.core.model.star.FishActivityInfo;\n';
const newImport = 'import com.gameplus.core.gameconfig.dmx.DmxReturnCampaignConf;\n';
const importHeader = 'package demo;\n\n';
const oldMethod = '    /** 旧加载入口 */\n    public static void reload() {\n        load();\n    }\n\n';
const changedBase = importHeader + oldImport + '\npublic class Changed {\n' + oldMethod + '    public void keep() {}\n    public int value() { return 1; }\n}\n';
const changedTarget = importHeader + newImport + oldImport + '\npublic class Changed {\n    public void keep() {}\n    public int value() { return 2; }\n}\n';
const largeHeader = Array.from({ length: 41 }, (_, i) => `// preserved header ${i}\n`).join('');
const largeTail = Array.from({ length: 20000 }, (_, i) => `// preserved source line ${i} keeps its original content\n`).join('');
const largeBase = largeHeader + oldImport + largeTail;
const largeTarget = largeHeader + newImport + oldImport + largeTail;
const firstArgument = '(com.gameplus.dao.star.IFishActivityInfoDao) context.getBean("fishActivityInfoDao"),';
const secondArgument = '(org.hibernate.SessionFactory) context.getBean("sessionFactoryStar")';
const partialTarget = `\t\tReturnCampaignActivity.initialize(\n\t\t\t\t${firstArgument}\n\t\t\t\t${secondArgument});\n`;
const partialTyped = `\t\tReturnCampaignActivity.initialize(\n\t\t\t\t\t${firstArgument}\n\t\t)`;
const tableBase = '2109\t境界排行榜\t0\t0\t1\t1\t0\t1\t0\t1\t0\t0\t1\t0\t0\t0\t0\n';
/** 保留截图中的中文、数字和 Tab 列，覆盖真实配置表的五行追加。 */
const tableAdded = ['回归仙途合集', '回归特惠祈愿', '回归特惠礼包', '回归七日签到', '回归征程']
  .map((name, index) => `${2110 + index}\t${name}\t0\t0\t1\t1\t0\t0\t0\t0\t0\t0\t1\t0\t0\t0\t0\n`).join('');
const commentBase = 'int iLogType = 0;\n// 双倍惊喜、命运祈福的妖灵由活动回调按来源记账，跳过主流程的零金额占位流水。\nif (iAddMoney != 0 || (!PayCode.IsSbjxGift(getChargePropRt.iPayCode)\n        && !PayCode.IsMyqfGift(getChargePropRt.iPayCode)))\n{\n    run();\n}\n';
const commentTarget = commentBase.replace('命运祈福', '命运祈福、超级发发发')
  .replace('IsMyqfGift(getChargePropRt.iPayCode)))', 'IsMyqfGift(getChargePropRt.iPayCode)\n        && !PayCode.IsCjfffGift(getChargePropRt.iPayCode)))');
const methodBase = 'public class Methods {\n    public void keep() {\n        run();\n    }\n}\n';
const methodAdded = '\n    /** 统一加载并校验回流策划表。 */\n    public synchronized boolean ReadReturnCampaignConf() {\n        try {\n            DmxReturnCampaignConf next = new DmxReturnCampaignConf();\n            validateReturnCampaignConf(next);\n            returnCampaignConf = next;\n            return true;\n        } catch (RuntimeException e) {\n            return false;\n        }\n    }\n\n    public DmxReturnCampaignConf getReturnCampaignConf() {\n        return returnCampaignConf;\n    }\n';
const methodTarget = methodBase.slice(0, -2) + methodAdded + '}\n';
const manualTarget = 'public class Manual {\n\tpublic int value() {\n\t\treturn 1;\n\t}\n}\n';

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
  await fs.writeFile(path.join(source, 'Header.java'), importHeader + oldImport);
  await fs.writeFile(path.join(source, 'replace.ts'), 'const value = 1;\n');
  await fs.writeFile(path.join(source, 'Changed.java'), changedBase);
  await fs.writeFile(path.join(source, 'Large.java'), largeBase);
  await fs.writeFile(path.join(source, 'activity.txt'), tableBase);
  await fs.writeFile(path.join(source, 'Comment.java'), commentBase);
  await fs.writeFile(path.join(source, 'Methods.java'), methodBase);
  git('add', '.'); git('commit', '--quiet', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(source, 'Empty.java'), emptyTarget);
  await fs.writeFile(path.join(source, 'Imports.java'), newImport + oldImport);
  await fs.writeFile(path.join(source, 'Header.java'), importHeader + newImport + oldImport);
  await fs.writeFile(path.join(source, 'replace.ts'), 'const value = 2;\n');
  await fs.writeFile(path.join(source, 'New.ts'), 'const custom = 1;\n');
  await fs.writeFile(path.join(source, 'Calls.ts'), 'call(1);\n');
  await fs.writeFile(path.join(source, 'Changed.java'), changedTarget);
  await fs.writeFile(path.join(source, 'Large.java'), largeTarget);
  await fs.writeFile(path.join(source, 'Partial.java'), partialTarget);
  await fs.writeFile(path.join(source, 'activity.txt'), tableBase + tableAdded);
  await fs.writeFile(path.join(source, 'Comment.java'), commentTarget);
  await fs.writeFile(path.join(source, 'Methods.java'), methodTarget);
  await fs.writeFile(path.join(source, 'Manual.java'), manualTarget);
  git('add', '.'); git('commit', '--quiet', '-m', 'target');
  await require('esbuild').build({ entryPoints: ['server/followService.ts'], outfile: path.join(root, 'follow-service.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
  await require(path.join(root, 'follow-service.cjs')).createFollow(source, path.join(root, 'practice'), base, 'HEAD');
  await require('esbuild').build({ entryPoints: ['vscode/followWorkspace.ts'], outfile: path.join(root, 'follow-workspace.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
  await require(path.join(root, 'follow-workspace.cjs')).ensureFollowWorkspace(path.join(root, 'practice'), '1.138.0');
  await fs.mkdir(path.join(root, 'profile', 'User'), { recursive: true });
  await fs.writeFile(path.join(root, 'profile', 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false,
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
  const checkpoint = async (name, editor, expectation = {}) => {
    checks.push({ name, text: editor.document.getText(), file: editor.document.fileName });
    try { await fs.access(path.join(root, 'capture-enabled')); } catch { return; }
    await fs.writeFile(path.join(root, 'capture-request.json'), JSON.stringify({ name, ...expectation }));
    for (let i = 0; i < 150; i++) {
      try { await fs.access(path.join(root, `captured-${name}`)); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error(`Screenshot driver did not capture ${name}`);
  };
  try {
    await vscode.extensions.getExtension('jtsgxh.ai-diff-follow').activate();
    // 全程逐键手写一个新文件，目标使用 Tab，编辑器自动缩进使用空格；不接受虚影或填入目标。
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Manual.java' });
    const manualEditor = vscode.window.activeTextEditor;
    await settle();
    await checkpoint('manual-empty', manualEditor, { expectedGhostContains: 'public class Manual' });
    await checkpoint('manual-class', manualEditor, { typeText: 'public class Manual {' });
    assert.equal(manualEditor.document.getText(), 'public class Manual {}');
    const enterKey = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' };
    await checkpoint('manual-class-enter', manualEditor, { pressKeys: [enterKey], expectedGhostContains: 'public int value' });
    await checkpoint('manual-method', manualEditor, { typeText: 'public int value() {' });
    await checkpoint('manual-method-enter', manualEditor, { pressKeys: [enterKey], expectedGhostContains: 'return 1;' });
    await checkpoint('manual-body', manualEditor, { typeText: 'return 1;' });
    const beforeUndo = manualEditor.document.getText();
    await checkpoint('manual-undo', manualEditor, { pressKeys: [{ key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }], expectedGhostSuffixOf: 'return 1;' });
    assert.notEqual(manualEditor.document.getText(), beforeUndo);
    await checkpoint('manual-redo', manualEditor, { pressKeys: [{ key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10 }] });
    assert.equal(manualEditor.document.getText(), beforeUndo);
    await checkpoint('manual-close-lines', manualEditor, { pressKeys: [
      { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }, { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
      { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }, { key: 'End', code: 'End', windowsVirtualKeyCode: 35 }, enterKey,
    ] });
    assert.equal(manualEditor.document.getText().replace(/\s/g, ''), manualTarget.replace(/\s/g, ''), 'Manual typing with native indentation and auto-closing must finish the target');
    assert.ok(manualEditor.document.getText().includes('    public int'), 'Exercise keeps the actual native space indentation');
    await manualEditor.document.save();
    // 覆盖截图中的旧方法右括号后插入整段方法，真实按键必须只增加换行和原生缩进。
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Methods.java' });
    const methodEditor = vscode.window.activeTextEditor;
    await settle();
    await checkpoint('method-before-enter', methodEditor, { expectedGhostContains: 'ReadReturnCampaignConf' });
    for (const [name, extra] of [['method-enter', {}], ['method-numpad-enter', { code: 'NumpadEnter', location: 3, isKeypad: true }]]) {
      const before = methodEditor.document.getText();
      await checkpoint(name, methodEditor, { pressKeys: [{ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', ...extra }] });
      const after = methodEditor.document.getText();
      assert.equal(after.replace(/\s/g, ''), before.replace(/\s/g, ''), 'Enter after an existing brace must not accept the following methods');
      assert.equal(after.split('\n').length, before.split('\n').length + 1, 'Enter must add exactly one real line');
      await methodEditor.edit(edit => edit.replace(new vscode.Range(0, 0, methodEditor.document.lineCount, 0), expected(methodEditor.document, methodBase)));
      await vscode.commands.executeCommand('aiDiff.follow.locate');
      await settle();
    }
    // 单独还原夹具目标，后续完整会话校验仍需覆盖所有文件。
    await methodEditor.edit(edit => edit.replace(new vscode.Range(0, 0, methodEditor.document.lineCount, 0), expected(methodEditor.document, methodTarget)));
    await methodEditor.document.save();
    // 日常编辑键必须只处理用户输入，不能把整段跟写目标作为一次按键的结果写入。
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Empty.java' });
    const keyEditor = vscode.window.activeTextEditor;
    await settle();
    await checkpoint('keys-before', keyEditor, { expectedGhostContains: 'class Empty' });
    // 快速按回车后立刻输入字符，必须保持用户输入顺序，不等待扩展宿主来回通信。
    await checkpoint('key-fast-enter-text', keyEditor, { keyDelayMs: 0, pressKeys: [
      { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      { key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80, text: 'p' },
    ] });
    assert.equal(keyEditor.document.getText(), expected(keyEditor.document, '\np'), 'Rapid Enter followed by text must preserve input order');
    await keyEditor.edit(edit => edit.delete(new vscode.Range(0, 0, keyEditor.document.lineCount, 0)));
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await checkpoint('key-enter', keyEditor, { pressKeys: [{ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }] });
    assert.equal(keyEditor.document.getText(), expected(keyEditor.document, '\n'), 'Enter must insert only a newline');
    await checkpoint('key-undo', keyEditor, { pressKeys: [{ key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }] });
    assert.equal(keyEditor.document.getText(), '');
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await checkpoint('key-tab', keyEditor, { pressKeys: [{ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }] });
    assert.match(keyEditor.document.getText(), /^[ \t]+$/, 'Tab must indent without accepting target code');
    await checkpoint('key-shift-tab', keyEditor, { pressKeys: [{ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }] });
    assert.equal(keyEditor.document.getText(), '', 'Shift+Tab must outdent without accepting target code');
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await checkpoint('key-word-right', keyEditor, { pressKeys: [{ key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 2 }] });
    assert.equal(keyEditor.document.getText(), '', 'Word navigation must not accept a ghost word');
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await checkpoint('key-escape', keyEditor, { pressKeys: [{ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }], expectedNoGhost: true });
    assert.equal(keyEditor.document.getText(), '');
    await vscode.commands.executeCommand('type', { text: 'pac' });
    await settle();
    await checkpoint('key-backspace', keyEditor, { pressKeys: [{ key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }] });
    assert.equal(keyEditor.document.getText(), 'pa');
    keyEditor.selection = new vscode.Selection(0, 0, 0, 0);
    await checkpoint('key-delete', keyEditor, { pressKeys: [{ key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }] });
    assert.equal(keyEditor.document.getText(), 'a');
    await keyEditor.edit(edit => edit.delete(new vscode.Range(0, 0, 0, 1)));
    await vscode.commands.executeCommand('editor.action.insertSnippet', { snippet: '${1:x} ${2:y}$0' });
    await vscode.commands.executeCommand('type', { text: 'pac' });
    await settle();
    await checkpoint('key-snippet-tab', keyEditor, { pressKeys: [{ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }] });
    assert.equal(keyEditor.document.getText(), 'pac y');
    assert.equal(keyEditor.document.getText(keyEditor.selection), 'y');
    await checkpoint('key-snippet-back', keyEditor, { pressKeys: [{ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }] });
    assert.equal(keyEditor.document.getText(keyEditor.selection), 'pac');
    await vscode.commands.executeCommand('leaveSnippet');
    await keyEditor.edit(edit => edit.delete(new vscode.Range(0, 0, 0, 5)));
    let offerWholeBlock = true;
    const normalCompletion = vscode.languages.registerCompletionItemProvider({ scheme: 'file', pattern: '**/Empty.java' }, {
      /** 模拟普通语言补全的单词和整段片段，验证 Enter 不接受建议而 Tab 仍可选正常条目。 */
      provideCompletionItems() {
        const item = new vscode.CompletionItem('normalName', vscode.CompletionItemKind.Variable);
        item.insertText = offerWholeBlock ? emptyTarget : 'normalName';
        // 候选允许以换行提交时，单纯绑定 type(换行) 仍会先接受整段文本。
        item.commitCharacters = ['\n'];
        return [item];
      },
    });
    try {
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await settle();
      await checkpoint('key-enter-menu', keyEditor, { pressKeys: [{ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }] });
      assert.equal(keyEditor.document.getText(), expected(keyEditor.document, '\n'), 'Enter must not accept a completion-menu block');
      await vscode.commands.executeCommand('hideSuggestWidget');
      await keyEditor.edit(edit => edit.delete(new vscode.Range(0, 0, 1, 0)));
      offerWholeBlock = false;
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await settle();
      await checkpoint('key-tab-menu', keyEditor, { pressKeys: [{ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }] });
      assert.equal(keyEditor.document.getText(), 'normalName', 'Tab must retain ordinary language completion');
    } finally { normalCompletion.dispose(); }
    await keyEditor.edit(edit => edit.delete(new vscode.Range(0, 0, 0, keyEditor.document.getText().length)));
    // 离开练习后恢复原生 Tab 接受普通内联候选，保护不能泄漏到其他编辑器。
    const outside = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'source', 'Imports.java')));
    const outsideBefore = outside.document.getText();
    const outsideEnd = outside.document.positionAt(outsideBefore.length);
    outside.selection = new vscode.Selection(outsideEnd, outsideEnd);
    await settle();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    await settle();
    await checkpoint('key-outside-tab', outside, { pressKeys: [{ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }] });
    assert.equal(outside.document.getText(), outsideBefore + 'COMPETING_PROVIDER_SENTINEL');
    await vscode.commands.executeCommand('undo');
    assert.equal(outside.document.getText(), outsideBefore);
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Comment.java' });
    const commentEditor = vscode.window.activeTextEditor;
    await settle();
    await checkpoint('comment-inline', commentEditor, { expectedGhostContains: '、超级发发发', expectedLens: '「、超级发发发」', expectedNoInsertionBorder: true });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await checkpoint('comment-click', commentEditor, { clickInsertion: true, expectedGhostContains: '、超级发发发', expectedLens: '待补写' });
    await vscode.commands.executeCommand('type', { text: '、超级' });
    await settle();
    await checkpoint('comment-typed', commentEditor, { expectedGhostContains: '发发发', expectedLens: '「发发发」' });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    for (let i = 0; commentEditor.document.getText() !== expected(commentEditor.document, commentTarget) && i < 8; i++) {
      await vscode.commands.executeCommand('aiDiff.follow.locate');
      await settle();
      if (!i) await checkpoint('condition-inline', commentEditor, { expectedGhostContains: 'IsCjfffGift', expectedLens: 'IsCjfffGift' });
      const previous = commentEditor.document.getText();
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      assert.notEqual(commentEditor.document.getText(), previous);
    }
    assert.equal(commentEditor.document.getText(), expected(commentEditor.document, commentTarget));
    await settle();
    await checkpoint('comment-complete', commentEditor, { expectedRemoval: '', expectedNoHints: true });
    await commentEditor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'activity.txt' });
    const tableEditor = vscode.window.activeTextEditor;
    await settle();
    await checkpoint('table-initial', tableEditor, { expectedGhostContains: '2110' });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await checkpoint('table-command', tableEditor, { expectedGhostContains: '2110' });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await checkpoint('table-click', tableEditor, { clickInsertion: true, expectedGhostContains: '2110', expectedInsertion: true });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(tableEditor.document.getText(), expected(tableEditor.document, tableBase + tableAdded.trimEnd()));
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(tableEditor.document.getText(), expected(tableEditor.document, tableBase + tableAdded));
    // 同一个独立测试文件改用 Windows 换行，重验点击及逐字输入，不改动用户练习。
    await tableEditor.edit(edit => edit.replace(new vscode.Range(0, 0, tableEditor.document.lineCount, 0), tableBase));
    await tableEditor.edit(edit => edit.setEndOfLine(vscode.EndOfLine.CRLF));
    assert.equal(tableEditor.document.eol, vscode.EndOfLine.CRLF);
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await checkpoint('table-crlf-click', tableEditor, { clickInsertion: true, expectedGhostContains: '2110' });
    await vscode.commands.executeCommand('type', { text: '21' });
    await settle();
    await checkpoint('table-typed', tableEditor, { expectedGhostContains: '回归仙途合集' });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(tableEditor.document.getText(), expected(tableEditor.document, tableBase + tableAdded));
    await tableEditor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Partial.java' });
    let editor = vscode.window.activeTextEditor;
    // 重现用户已写第一个参数且编辑器自动缩进多出一个 Tab 的真实缓冲区。
    assert.equal(await editor.edit(edit => edit.insert(new vscode.Position(0, 0), expected(editor.document, partialTyped))), true);
    await settle();
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await settle();
    await checkpoint('partial-arguments', editor, { expectedProtected: firstArgument, expectedRemoval: '', expectedGhostContains: 'org.hibernate.SessionFactory' });
    // 保留已经写下的额外 Tab，不能为了让虚影出现而在测试中先替用户删缩进。
    for (let i = 0; editor.document.getText().replace(/\s/g, '') !== partialTarget.replace(/\s/g, '') && i < 10; i++) {
      await vscode.commands.executeCommand('aiDiff.follow.locate');
      await settle();
      if (i === 0) await checkpoint('partial-parameter-ghost', editor, { expectedGhostContains: 'org.hibernate.SessionFactory' });
      const before = editor.document.getText();
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
      assert.notEqual(editor.document.getText(), before, 'Missing argument must be available as a ghost insertion');
      assert.ok(editor.document.getText().includes(firstArgument), 'Completing the call must retain the correct first argument');
    }
    assert.equal(editor.document.getText().replace(/\s/g, ''), partialTarget.replace(/\s/g, ''));
    assert.ok(editor.document.getText().includes('\t'.repeat(5) + firstArgument), 'The already written extra indentation must be preserved');
    await settle();
    await checkpoint('partial-complete', editor, { expectedRemoval: '', expectedInstruction: '' });
    await editor.document.save();
    // 普通打开并恢复第 22 行旧光标，不调用跟写专用打开命令，验证自动定位入口。
    editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(practice, 'Large.java')));
    editor.selection = new vscode.Selection(21, 0, 21, 0);
    await settle();
    assert.equal(editor.selection.active.line, 40);
    await checkpoint('large-restored', editor, { expectedGhost: newImport.trimEnd(), existingLine: oldImport.trimEnd() });
    editor.selection = new vscode.Selection(21, 0, 21, 0);
    editor.revealRange(new vscode.Range(40, 0, 42, 0), vscode.TextEditorRevealType.InCenter);
    await settle();
    assert.equal(editor.selection.active.line, 21, 'reading elsewhere must not be interrupted by repeated jumps');
    await checkpoint('large-off-cursor', editor, { expectedInsertion: true, existingLine: oldImport.trimEnd() });
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', editor.document.uri);
    const insertionLens = lenses.find(lens => lens.command?.command === 'aiDiff.follow.locate');
    assert.ok(insertionLens, 'Current insertion must have a clickable display-ghost command');
    await vscode.commands.executeCommand(insertionLens.command.command, ...(insertionLens.command.arguments || []));
    await settle();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(editor.document.getText(), expected(editor.document, largeTarget));
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Changed.java' });
    await settle();
    editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), expected(editor.document, changedBase), 'opening must preserve all original code');
    const methodLine = editor.document.positionAt(editor.document.getText().indexOf('    /** 旧加载入口 */')).line;
    editor.selection = new vscode.Selection(methodLine + 1, 0, methodLine + 1, 0);
    editor.revealRange(new vscode.Range(methodLine, 0, methodLine + 4, 0), vscode.TextEditorRevealType.InCenter);
    await settle();
    await checkpoint('all-removals', editor, { expectedRemoval: 'public static void reload()', expectedInstruction: '待删除' });
    // 此检查仅验证精确目标下装饰清除；编辑器的多行 type 会自动重缩进，使用真实文档编辑避免混入格式差异。
    const wholeDocument = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
    assert.equal(await editor.edit(edit => edit.replace(wholeDocument, expected(editor.document, changedTarget))), true);
    assert.equal(editor.document.getText(), expected(editor.document, changedTarget));
    await settle();
    await checkpoint('removals-complete', editor, { expectedRemoval: '', expectedInstruction: '' });
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Empty.java' });
    await settle();
    editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), '');
    assert.equal(await fs.readFile(path.join(practice, 'Empty.java'), 'utf8'), '');
    await checkpoint('empty', editor);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(editor.document.getText(), expected(editor.document, emptyTarget), 'first candidate must work before any typing');
    await vscode.commands.executeCommand('undo');
    assert.equal(editor.document.getText(), '');
    await settle();
    await vscode.commands.executeCommand('workbench.action.focusSideBar');
    await settle();
    await checkpoint('blurred', editor);
    await vscode.commands.executeCommand('aiDiff.follow.locate');
    await vscode.commands.executeCommand('editor.action.insertSnippet', { snippet: '${1:x}$0' });
    await vscode.commands.executeCommand('type', { text: 'pac' });
    await settle();
    await checkpoint('snippet-prefix', editor);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(editor.document.getText(), expected(editor.document, emptyTarget), 'snippet mode must retain the follow candidate');
    await vscode.commands.executeCommand('undo');
    assert.equal(editor.document.getText(), 'pac');
    await vscode.commands.executeCommand('leaveSnippet');
    // 逐字符模拟手敲并保留原生按键行为，不能只验证一次粘贴整行。
    for (const text of 'kage demo;\n') {
      await vscode.commands.executeCommand('type', { text });
      await new Promise(resolve => setTimeout(resolve, 160));
    }
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
    await checkpoint('imports-first-line', editor, { expectedGhost: newImport.trimEnd(), existingLine: oldImport.trimEnd() });
    await checkpoint('imports', editor, { typeText: 'imp', expectedGhost: newImport.trimEnd().slice(3), existingLine: oldImport.trimEnd() });
    assert.equal(editor.document.getText(), expected(editor.document, 'imp' + oldImport), 'Showing the inserted line must not write the answer or move the existing import');
    await checkpoint('imports-rest', editor, { typeText: newImport.trimEnd().slice(3) });
    // 首行直接手写后，快速换行与后一个字符也必须按原生顺序执行，不再异步移回上一行。
    await checkpoint('imports-fast-enter', editor, { keyDelayMs: 0, pressKeys: [enterKey,
      { key: 'i', code: 'KeyI', windowsVirtualKeyCode: 73, text: 'i' },
    ] });
    await settle();
    assert.equal(editor.document.getText(), expected(editor.document, newImport + 'i' + oldImport), 'Fast first-line typing must keep the character after the newline');
    assert.equal(editor.selection.active.line, 1);
    await checkpoint('imports-backspace', editor, { pressKeys: [{ key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }] });
    assert.equal(editor.document.getText(), expected(editor.document, newImport + oldImport));
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Header.java' });
    await settle();
    editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), expected(editor.document, importHeader + oldImport));
    await checkpoint('imports-with-header', editor, { expectedGhost: newImport.trimEnd(), existingLine: oldImport.trimEnd() });
    await vscode.commands.executeCommand('type', { text: '\n' });
    for (const text of 'imp') {
      await vscode.commands.executeCommand('type', { text });
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    await settle();
    await checkpoint('imports-typed', editor, { expectedGhost: newImport.trimEnd().slice(3), existingLine: oldImport.trimEnd() });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(editor.document.getText(), expected(editor.document, importHeader + newImport + oldImport));
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'replace.ts' });
    await settle();
    editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.getText(), expected(editor.document, 'const value = 1;\n'));
    await checkpoint('replacement-before', editor, { expectedLens: '「1」 → 「2」', expectedRemoval: '1', expectedInstruction: '待替换' });
    await vscode.commands.executeCommand('deleteRight');
    await settle();
    assert.equal(editor.document.getText(), expected(editor.document, 'const value = ;\n'));
    await checkpoint('replacement', editor);
    await vscode.commands.executeCommand('type', { text: '2' });
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'New.ts' });
    editor = vscode.window.activeTextEditor;
    await settle();
    for (const text of 'con') {
      await vscode.commands.executeCommand('type', { text });
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    await settle();
    await checkpoint('completion-prefix', editor);
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await settle();
    await checkpoint('completion-menu', editor);
    await vscode.commands.executeCommand('hideSuggestWidget');
    await settle();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    assert.equal(editor.document.getText(), expected(editor.document, 'const custom = 1;\n'));
    await editor.document.save();
    await vscode.commands.executeCommand('aiDiff.follow.open', { path: 'Calls.ts' });
    editor = vscode.window.activeTextEditor;
    await vscode.commands.executeCommand('type', { text: 'call' });
    await vscode.commands.executeCommand('type', { text: '(' });
    assert.equal(editor.document.getText(), 'call()', 'native auto closing must remain available');
    await settle();
    await checkpoint('auto-close', editor);
    await vscode.commands.executeCommand('type', { text: '1' });
    await vscode.commands.executeCommand('type', { text: ')' });
    await vscode.commands.executeCommand('type', { text: ';\n' });
    assert.equal(editor.document.getText(), expected(editor.document, 'call(1);\n'));
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
