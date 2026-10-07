import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registerPocketPiFiles } from '../routes.mjs';

export async function fixture(t, options = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pocket-files-'));
  const home = path.join(temp, 'home');
  const pinned = path.join(temp, 'project');
  await fs.mkdir(home);
  await fs.mkdir(pinned);
  const app = Fastify();
  registerPocketPiFiles(app, {
    home,
    preferencesStore: { getPinnedDirectories: () => [pinned] },
    sessionManager: { listAll: () => [{ cwd: pinned }] },
    networkGuard: async (request, reply) => {
      if (request.headers['x-deny']) reply.code(403).send({ success: false, error: 'Access denied' });
    },
    ...options,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await fs.rm(temp, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const url = (suffix = '', query = {}) => `${origin}/api/pocket-pi/files${suffix}?${new URLSearchParams({ cwd: home, ...query })}`;
  const put = (name, body, query = {}) => fetch(url('', { name, ...query }), {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body,
  });
  return { app, home, pinned, temp, origin, url, put };
}

export async function eventually(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Condition did not become true');
}
