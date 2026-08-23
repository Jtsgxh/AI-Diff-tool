import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

const DEFAULT_API_PORT = 4000;
const DEFAULT_CLIENT_PORT = 5173;

export default defineConfig(({ mode }) => {
  // Read the unprefixed vars too, so `PORT` in .env reaches both halves of the
  // app. The proxy target used to be hard-coded: moving the server off 4000
  // silently broke every API call from the client.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };

  const apiPort = Number(env.PORT) || DEFAULT_API_PORT;
  const clientPort = Number(env.CLIENT_PORT) || DEFAULT_CLIENT_PORT;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: clientPort,
      proxy: {
        '/api': {
          // 127.0.0.1 rather than localhost: on Windows, localhost can resolve
          // to ::1 first while the server is listening on IPv4, which surfaces
          // as ECONNREFUSED on every request.
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          // Agent reviews stream for minutes. The proxy default (often 2 min)
          // was cutting SSE mid-report and the UI treated the drop as success.
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
  };
});
