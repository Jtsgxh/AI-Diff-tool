import dotenv from 'dotenv';
import { startServer } from './runtime';

dotenv.config();

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';

function failServer(err: NodeJS.ErrnoException): never {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to a free port.`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    const server = await startServer({ host: HOST, port: PORT });
    console.log(`🚀 Git Semantic Server running at http://${HOST}:${PORT}`);
    server.on('error', failServer);
  } catch (err) {
    failServer(err as NodeJS.ErrnoException);
  }
}

void main();
