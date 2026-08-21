import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './http/errors';
import { aiRouter } from './routes/ai';
import { repoRouter } from './routes/repo';
import { systemRouter } from './routes/system';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors());
// Diffs for large commits are posted back with each AI request.
app.use(express.json({ limit: '10mb' }));

app.use('/api/system', systemRouter);
app.use('/api/repo', repoRouter);
app.use('/api/ai', aiRouter);

// Must be registered last: it is the single place errors become responses.
app.use(errorHandler);

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Git Semantic Server running at http://${HOST}:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to a free port.`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
