import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { installDashboardFiles } from '../install.mjs';

async function installation(t, source = '  registerFileRoutes(fastify, { sessionManager, preferencesStore, networkGuard });') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pocket-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = path.join(root, 'packages/server/src/server.ts');
  const web = path.join(root, 'node_modules/@blackbelt-technology/pi-dashboard-web');
  const index = path.join(web, 'dist/index.html');
  await fs.mkdir(path.dirname(server), { recursive: true });
  await fs.mkdir(path.dirname(index), { recursive: true });
  await fs.writeFile(server, source);
  await fs.writeFile(path.join(web, 'package.json'), '{"name":"@blackbelt-technology/pi-dashboard-web"}');
  const html = '<html><head></head><body><div id="root"></div></body></html>';
  await fs.writeFile(index, html);
  await fs.writeFile(index + '.gz', gzipSync(html));
  await fs.writeFile(index + '.br', brotliCompressSync(html));
  return { root, server, index, source, html };
}

test('installs server/client integration idempotently, including compressed HTML', async t => {
  const { root, server, index } = await installation(t);
  installDashboardFiles(root);
  const source = await fs.readFile(server, 'utf8');
  const html = await fs.readFile(index, 'utf8');
  const files = [server, index, index + '.gz', index + '.br',
    ...['routes.mjs', 'client.js', 'client.css'].map(name => path.join(path.dirname(server), 'pocket-pi-files', name))];
  const timestamps = await Promise.all(files.map(async file => (await fs.stat(file, { bigint: true })).mtimeNs));
  await new Promise(resolve => setTimeout(resolve, 20));
  installDashboardFiles(root);
  assert.deepEqual(await Promise.all(files.map(async file => (await fs.stat(file, { bigint: true })).mtimeNs)), timestamps);
  assert.equal(await fs.readFile(server, 'utf8'), source);
  assert.equal(await fs.readFile(index, 'utf8'), html);
  assert.equal(source.split('registerPocketPiFiles(fastify,').length, 2);
  assert.equal(html.split('/api/pocket-pi/files/client.js').length, 2);
  assert.equal(gunzipSync(await fs.readFile(index + '.gz')).toString(), html);
  assert.equal(brotliDecompressSync(await fs.readFile(index + '.br')).toString(), html);
  for (const name of ['routes.mjs', 'client.js', 'client.css']) {
    assert.equal(await fs.readFile(path.join(path.dirname(server), 'pocket-pi-files', name), 'utf8'),
      await fs.readFile(new URL('../' + name, import.meta.url), 'utf8'));
  }
});

test('unsupported source layout fails before modifying server or HTML', async t => {
  const { root, server, index, source, html } = await installation(t, '// upstream changed');
  assert.throws(() => installDashboardFiles(root), /Unsupported dashboard layout/);
  assert.equal(await fs.readFile(server, 'utf8'), source);
  assert.equal(await fs.readFile(index, 'utf8'), html);
});

test('reapplies after an npm update replaces the installed sources', async t => {
  const { root, server, index, source, html } = await installation(t);
  installDashboardFiles(root);
  await fs.writeFile(server, source);
  await fs.writeFile(index, html);
  installDashboardFiles(root);
  assert.match(await fs.readFile(server, 'utf8'), /registerPocketPiFiles/);
  assert.match(await fs.readFile(index, 'utf8'), /files\/client.js/);
});

async function publishedServer(root, source) {
  const directory = path.join(root, 'node_modules/@blackbelt-technology/pi-dashboard-server');
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), '{"name":"@blackbelt-technology/pi-dashboard-server"}');
  const server = path.join(directory, 'src/server.ts');
  await fs.writeFile(server, source);
  return server;
}

test('patches the extension auto-start server and the web package resolved from each server', async t => {
  const { root, server, index, source, html } = await installation(t);
  const published = await publishedServer(root, source);
  // A nested web dependency can differ from the CLI's hoisted web package.
  const web = path.join(path.dirname(published), '../node_modules/@blackbelt-technology/pi-dashboard-web');
  await fs.mkdir(path.join(web, 'dist'), { recursive: true });
  await fs.writeFile(path.join(web, 'package.json'), '{"name":"@blackbelt-technology/pi-dashboard-web"}');
  const nestedIndex = path.join(web, 'dist/index.html');
  await fs.writeFile(nestedIndex, html);
  installDashboardFiles(root);
  installDashboardFiles(root);
  for (const file of [server, published]) {
    assert.equal((await fs.readFile(file, 'utf8')).split('registerPocketPiFiles(fastify,').length, 2);
    assert.match(await fs.readFile(path.join(path.dirname(file), 'pocket-pi-files/routes.mjs'), 'utf8'), /registerPocketPiFiles/);
  }
  for (const file of [index, nestedIndex]) {
    assert.equal((await fs.readFile(file, 'utf8')).split('/api/pocket-pi/files/client.js').length, 2);
  }
});

test('validates both server layouts before changing either installation', async t => {
  const { root, server, index, source, html } = await installation(t);
  await publishedServer(root, '// unsupported new layout');
  assert.throws(() => installDashboardFiles(root), /Unsupported dashboard layout/);
  assert.equal(await fs.readFile(server, 'utf8'), source);
  assert.equal(await fs.readFile(index, 'utf8'), html);
});
