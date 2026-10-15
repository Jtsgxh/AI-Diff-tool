import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/runtime';

let server: Server | undefined;

/** 父扩展退出或断开 IPC 时关闭服务，不遗留后台进程。 */
function shutdown(): void {
  server?.closeAllConnections();
  server?.close();
  process.exit(0);
}

process.once('disconnect', shutdown);
process.once('message', (message: unknown) => {
  const token = message && typeof message === 'object' ? (message as { token?: unknown }).token : undefined;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    process.send?.({ type: 'error', error: '无效的后台启动凭证。' });
    process.exitCode = 1;
    process.disconnect?.();
    return;
  }
  // AI SDK 的全局进程监听仅存在于此子进程，不进入共享扩展宿主。
  void startServer({ host: '127.0.0.1', port: 0, accessToken: token }).then((started) => {
    server = started;
    if (!process.connected) { shutdown(); return; }
    process.send?.({ type: 'ready', port: (server.address() as AddressInfo).port });
  }).catch((error: unknown) => {
    process.send?.({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
    process.disconnect?.();
  });
});
