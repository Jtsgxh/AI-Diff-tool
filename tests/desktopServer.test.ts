import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/runtime';

test('extension server requires a private token before exposing repository APIs', async (t) => {
  const server = await startServer({ host: '127.0.0.1', port: 0, accessToken: 'extension-test-token' });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${origin}/api/system/quick-paths`)).status, 401);
  assert.equal((await fetch(`${origin}/api/system/quick-paths`, { headers: { 'x-ai-diff-token': 'wrong' } })).status, 401);
  const authorized = await fetch(`${origin}/api/system/quick-paths`, { headers: { 'x-ai-diff-token': 'extension-test-token' } });
  assert.equal(authorized.status, 200);
  assert.ok(Array.isArray((await authorized.json()).shortcuts));
});

test('desktop server exposes the built UI and API on one origin', async (t) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-diff-desktop-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<main>desktop marker</main>', 'utf8');

  const server = await startServer({ host: '127.0.0.1', port: 0, staticDir });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  const pageResponse = await fetch(origin);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(await pageResponse.text(), /desktop marker/);

  const apiResponse = await fetch(`${origin}/api/system/quick-paths`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(apiResponse.status, 200);
  assert.equal(apiResponse.headers.get('access-control-allow-origin'), null);
  const apiPayload = (await apiResponse.json()) as { shortcuts?: unknown[] };
  assert.ok(Array.isArray(apiPayload.shortcuts));

  const missingApiResponse = await fetch(`${origin}/api/not-a-real-route`);
  assert.equal(missingApiResponse.status, 404);
  assert.doesNotMatch(await missingApiResponse.text(), /desktop marker/);
});
