import type { HostBootstrap, HostRequest, HostResponse } from '../../shared/vscodeBridge';

declare const acquireVsCodeApi: undefined | (() => { postMessage(message: HostRequest): void });

interface PendingRequest {
  resolve(response: Response): void;
  reject(reason: unknown): void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  cleanup(): void;
}

// API 对象保持在模块内，不能暴露给 window 或 Markdown 内容。
const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const requests = new Map<number, PendingRequest>();
let sequence = 0;

/** 从扩展生成的根节点读取初始工作区和已保存设置。 */
function readBootstrap(): HostBootstrap {
  if (!host || typeof document === 'undefined') return { storage: {} };
  try {
    return JSON.parse(document.getElementById('root')?.dataset.vscode || '{"storage":{}}');
  } catch {
    return { storage: {} };
  }
}

const bootstrap = readBootstrap();
export const isVSCodeHost = Boolean(host);
export const initialVSCodeRepository = bootstrap.repoPath;
export const initialVSCodeRevision = bootstrap.revision;

/** 接收宿主流片段，沿用页面已有的 JSON 和 SSE 消费流程。 */
function receiveHostMessage(event: MessageEvent<HostResponse>): void {
  const message = event.data;
  if (message?.type === 'selectRevision') {
    window.dispatchEvent(new CustomEvent('ai-diff-select-revision', { detail: message }));
    return;
  }
  if (!message || typeof message.id !== 'number') return;
  const pending = requests.get(message.id);
  if (!pending) return;
  if (message.type === 'start') {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { pending.controller = controller; },
      cancel() {
        host?.postMessage({ type: 'cancel', id: message.id });
        pending.cleanup();
      },
    });
    pending.resolve(new Response([204, 205, 304].includes(message.status) ? null : stream, {
      status: message.status, headers: message.headers,
    }));
  } else if (message.type === 'data') {
    pending.controller?.enqueue(new TextEncoder().encode(message.data));
  } else if (message.type === 'end') {
    pending.controller?.close();
    pending.cleanup();
  } else if (message.type === 'error') {
    const error = new Error(message.error);
    pending.controller?.error(error);
    pending.reject(error);
    pending.cleanup();
  }
}

if (host) window.addEventListener('message', receiveHostMessage);

/** 在浏览器使用 fetch，在 VS Code 中通过消息传输请求并支持取消。 */
export function hostFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!host) return fetch(input, init);
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    if (init.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    /** 清除请求和调用方的取消监听，避免长期 SSE 会话泄漏。 */
    const cleanup = () => {
      requests.delete(id);
      init.signal?.removeEventListener('abort', abort);
    };
    /** 取消页面读取时同步终止宿主 HTTP 请求。 */
    const abort = () => {
      host.postMessage({ type: 'cancel', id });
      const error = new DOMException('Aborted', 'AbortError');
      requests.get(id)?.controller?.error(error);
      reject(error);
      cleanup();
    };
    requests.set(id, { resolve, reject, cleanup });
    init.signal?.addEventListener('abort', abort, { once: true });
    host.postMessage({ type: 'request', id, path: input, method: init.method === 'POST' ? 'POST' : 'GET',
      body: typeof init.body === 'string' ? init.body : undefined });
  });
}

/** 将当前参考文件交给原生编辑器；历史版本由宿主提供只读文档。 */
export function openVSCodeFile(repoPath: string, filePath: string, revision?: string): void {
  host?.postMessage({ type: 'openFile', repoPath, filePath, revision });
}

/** 读取宿主设置；普通浏览器返回 undefined 并继续使用 localStorage。 */
export function readHostStorage(key: string): string | null | undefined {
  return host ? bootstrap.storage[key] ?? null : undefined;
}

/** 更新本地镜像并通知宿主持久化，API 配置由宿主放入 SecretStorage。 */
export function writeHostStorage(key: string, value: string | null): boolean {
  if (!host) return false;
  if (value === null) delete bootstrap.storage[key];
  else bootstrap.storage[key] = value;
  host.postMessage({ type: 'storage', key, value });
  return true;
}
