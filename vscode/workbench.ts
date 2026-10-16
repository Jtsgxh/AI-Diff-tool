import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import type { HostBootstrap, HostRequest, HostResponse } from '../shared/vscodeBridge';

/** 转义 HTML 属性中的仓库路径、设置和资源地址。 */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 只允许当前扩展临时服务的 API，不接受外部 URL 或任意宿主命令。 */
export function apiRequestUrl(origin: string, requestPath: string): string {
  const url = new URL(requestPath, origin);
  if (!requestPath.startsWith('/api/') || url.origin !== origin || !/^\/api\/(repo|system|ai)\//.test(url.pathname) || url.hash) {
    throw new Error('不允许访问该地址。');
  }
  return url.href;
}

/** 管理现有 React 工作台的宿主服务、设置和流式消息生命周期。 */
export class VSCodeWorkbench implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private backend?: ChildProcess;
  private starting?: Promise<string>;
  private readonly token = randomBytes(32).toString('hex');
  private readonly requests = new Map<number, AbortController>();
  private readonly saved: Record<string, string>;
  private storageQueue = Promise.resolve();
  private opening?: Promise<void>;
  private openingReference?: Pick<HostBootstrap, 'repoPath' | 'revision'>;
  private disposed = false;

  /** 加载非敏感页面状态，API 配置在打开页面时从 SecretStorage 单独取出。 */
  constructor(private readonly context: vscode.ExtensionContext,
    private readonly openFile: (repo: string, file: string, revision?: string) => Promise<void>) {
    this.saved = { ...context.globalState.get<Record<string, string>>('webviewStorage', {}) };
    delete this.saved.git_ai_config;
  }

  /** 在需要时启动随机端口服务；凭证只保留在扩展宿主中。 */
  private origin(): Promise<string> {
    if (!this.starting) {
      this.starting = new Promise<string>((resolve, reject) => {
        const options = {
          execArgv: [], silent: true, windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        };
        const backend = fork(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'backend.cjs').fsPath, [], options);
        this.backend = backend;
        let ready = false;
        /** 启动失败时释放进程和等待定时器，允许随后重试。 */
        const fail = (error: Error) => {
          clearTimeout(timeout);
          backend.kill();
          reject(error);
        };
        const timeout = setTimeout(() => fail(new Error('后台服务启动超时。')), 15000);
        backend.on('error', fail);
        backend.on('message', (value: unknown) => {
          if (!value || typeof value !== 'object') return;
          const message = value as { type?: string; port?: number; error?: string };
          if (message.type === 'ready' && Number.isInteger(message.port) && message.port! > 0 && message.port! <= 65535) {
            clearTimeout(timeout);
            if (this.disposed) { fail(new Error('工作台已关闭。')); return; }
            ready = true;
            resolve(`http://127.0.0.1:${message.port}`);
          } else if (message.type === 'error') fail(new Error(message.error || '后台启动失败。'));
        });
        backend.on('exit', () => {
          clearTimeout(timeout);
          if (this.backend === backend) { this.backend = undefined; this.starting = undefined; }
          if (!ready) reject(new Error('后台服务未能启动。'));
          else if (!this.disposed) void vscode.window.showErrorMessage('AI Diff 后台服务已退出，请关闭并重新打开工作台。');
        });
        // 子进程日志不转发到页面；凭证通过 IPC 发送，不写入命令行或页面。
        backend.stdout?.resume();
        backend.stderr?.resume();
        backend.send({ token: this.token }, (error) => { if (error) fail(error); });
      }).catch((error) => { this.starting = undefined; throw error; });
    }
    return this.starting;
  }

  /** 复用已有面板，避免快速连续触发时创建多个后端或页面。 */
  open(repoPath?: string, revision?: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('工作台已关闭。'));
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      if (repoPath) this.updateReference(repoPath, revision);
      return Promise.resolve();
    }
    if (!this.opening || repoPath) this.openingReference = { repoPath, revision };
    if (!this.opening) this.opening = this.create().finally(() => {
      this.opening = undefined;
      this.openingReference = undefined;
    });
    return this.opening;
  }

  /** 已打开参考面板时同步新步骤，不打断编辑器或强制创建页面。 */
  updateReference(repoPath: string, revision?: string): void {
    if (this.disposed) return;
    // 页面尚未创建时保留最后一次目标，随初始内容一起交付，不向未加载页面抢发消息。
    if (this.opening) this.openingReference = { repoPath, revision };
    void this.panel?.webview.postMessage({ type: 'selectRevision', repoPath, revision } satisfies HostResponse);
  }

  /** 加载打包资源并建立受限消息通道，原有页面不直接连接本地服务。 */
  private async create(): Promise<void> {
    const origin = await this.origin();
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    let html = await fs.readFile(vscode.Uri.joinPath(media, 'index.html').fsPath, 'utf8');
    const config = await this.context.secrets.get('webviewAIConfig');
    // 资源和密钥读取均可跨越扩展释放；创建面板前重新确认，避免留下无人管理的页面。
    if (this.disposed) throw new Error('工作台已关闭。');
    const bootstrap: HostBootstrap = { ...this.openingReference, storage: { ...this.saved, ...(config ? { git_ai_config: config } : {}) } };
    const panel = vscode.window.createWebviewPanel('aiDiff.workbench', 'AI Diff · 审查与学习', vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    this.panel = panel;
    const nonce = randomBytes(24).toString('hex');
    // VS Code 使用本地字体与图标，避免网页入口的外部字体和不存在的 favicon 请求。
    html = html.replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com|\/vite\.svg)[^>]*>/g, '');
    html = html.replace(/(src|href)="(?:\.\/)?(assets\/[^"<>]+)"/g, (_match, attribute: string, relative: string) =>
      `${attribute}="${escapeAttribute(panel.webview.asWebviewUri(vscode.Uri.joinPath(media, relative)).toString())}"`);
    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
    html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} https: data:; font-src ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource}; worker-src blob:;">`);
    html = html.replace('id="root"', `id="root" data-vscode="${escapeAttribute(JSON.stringify(bootstrap))}"`);
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.receive(message, origin, panel).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`AI Diff：${error instanceof Error ? error.message : String(error)}`);
      });
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined;
      for (const controller of this.requests.values()) controller.abort();
      this.requests.clear();
    });
    panel.webview.html = html;
  }

  /** 校验消息结构后分别处理 API、文件导航和设置，不转发任意命令。 */
  private async receive(value: unknown, origin: string, panel: vscode.WebviewPanel): Promise<void> {
    if (!value || typeof value !== 'object' || this.panel !== panel) return;
    const message = value as HostRequest;
    if (message.type === 'cancel' && Number.isSafeInteger(message.id)) {
      this.requests.get(message.id)?.abort();
    } else if (message.type === 'storage' && typeof message.key === 'string' && message.key.startsWith('git_') &&
      (message.value === null || typeof message.value === 'string')) {
      this.store(message.key, message.value);
    } else if (message.type === 'openFile' && typeof message.repoPath === 'string' && typeof message.filePath === 'string' &&
      (message.revision === undefined || typeof message.revision === 'string')) {
      await this.openFile(message.repoPath, message.filePath, message.revision);
    } else if (message.type === 'request' && Number.isSafeInteger(message.id) && typeof message.path === 'string' &&
      (message.method === 'GET' || message.method === 'POST') && (message.body === undefined || typeof message.body === 'string')) {
      await this.proxy(message, origin, panel);
    }
  }

  /** 顺序保存状态；包含 API Key 的完整模型配置使用 VS Code SecretStorage。 */
  private store(key: string, value: string | null): void {
    if (key !== 'git_ai_config') {
      if (value === null) delete this.saved[key];
      else this.saved[key] = value;
    }
    this.storageQueue = this.storageQueue.then(async () => {
      if (key === 'git_ai_config') {
        if (value === null) await this.context.secrets.delete('webviewAIConfig');
        else await this.context.secrets.store('webviewAIConfig', value);
      } else await this.context.globalState.update('webviewStorage', { ...this.saved });
    }).catch(() => { void vscode.window.showWarningMessage('AI Diff 设置保存失败，本次页面内仍可使用。'); });
  }

  /** 转发 JSON 或 SSE 字节流，关闭面板和取消生成都会中止实际后端请求。 */
  private async proxy(message: Extract<HostRequest, { type: 'request' }>, origin: string, panel: vscode.WebviewPanel): Promise<void> {
    const controller = new AbortController();
    this.requests.get(message.id)?.abort();
    this.requests.set(message.id, controller);
    /** 发送有序流帧，页面销毁后及时终止响应读取。 */
    const send = async (response: HostResponse) => {
      if (this.panel !== panel || !(await panel.webview.postMessage(response))) controller.abort();
    };
    try {
      const response = await fetch(apiRequestUrl(origin, message.path), { method: message.method,
        headers: { 'Content-Type': 'application/json', 'x-ai-diff-token': this.token },
        body: message.method === 'POST' ? message.body : undefined, signal: controller.signal, redirect: 'error' });
      await send({ type: 'start', id: message.id, status: response.status,
        headers: { 'content-type': response.headers.get('content-type') || 'application/json' } });
      const decoder = new TextDecoder();
      if (response.body) {
        for await (const chunk of response.body) {
          const data = decoder.decode(chunk, { stream: true });
          if (data) await send({ type: 'data', id: message.id, data });
        }
        const last = decoder.decode();
        if (last) await send({ type: 'data', id: message.id, data: last });
      }
      await send({ type: 'end', id: message.id });
    } catch (error) {
      if (!controller.signal.aborted) await send({ type: 'error', id: message.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.requests.get(message.id) === controller) this.requests.delete(message.id);
    }
  }

  /** 释放面板和随机端口服务，防止扩展重载后遗留监听端口。 */
  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.backend?.kill();
  }
}
