import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { errorHandler } from './http/errors';
import { aiRouter } from './routes/ai';
import { repoRouter } from './routes/repo';
import { systemRouter } from './routes/system';

export interface CreateAppOptions {
  staticDir?: string;
}

/** Creates the single HTTP application used by both development and Electron. */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  if (options.staticDir) {
    // The packaged server can read arbitrary local repositories. Keep browser
    // pages outside this application from reading those loopback responses.
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
          "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; " +
          "form-action 'none'; frame-ancestors 'none'"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });
  } else {
    // Development uses the Vite proxy, while direct API clients retain the
    // cross-origin behavior the standalone server already provided.
    app.use(cors());
  }
  // Large multi-file diffs are posted with each AI request. Keep only a process
  // safety ceiling here; the real prompt size is governed by the configured
  // model context window rather than an obsolete 10 MB transport cap.
  app.use(express.json({ limit: '256mb' }));

  app.use('/api/system', systemRouter);
  app.use('/api/repo', repoRouter);
  app.use('/api/ai', aiRouter);

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    // Keep non-API navigation inside the desktop application. API misses must
    // remain API misses instead of being disguised as the HTML entry point.
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

  // Must be registered last: it is the single place errors become responses.
  app.use(errorHandler);

  return app;
}
