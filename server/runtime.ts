import type { Server } from 'node:http';
import { createApp } from './app';

export interface StartServerOptions {
  host?: string;
  port?: number;
  staticDir?: string;
}

export async function startServer(options: StartServerOptions = {}): Promise<Server> {
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 4000;
  const app = createApp({ staticDir: options.staticDir });
  const server = app.listen(port, host);

  // Agent reviews are long-lived SSE. Node's 5-minute requestTimeout would
  // otherwise destroy the socket mid-report on a slow reasoning model.
  // (`headersTimeout = 0` is NOT "disabled" — Node treats 0 as "reset to 60s".)
  server.timeout = 0;
  server.requestTimeout = 0;

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });

  return server;
}
