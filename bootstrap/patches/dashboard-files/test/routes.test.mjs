import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { fixture, eventually } from './helpers.mjs';

const exists = file => fs.stat(file).then(() => true, () => false);

test('roots include home, pinned folders and sessions without duplicates', async t => {
  const { url, home, pinned } = await fixture(t);
  const response = await fetch(url('/roots'));
  assert.deepEqual((await response.json()).data.roots, [home, pinned]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('binary, empty and Unicode files round-trip in the selected folder', async t => {
  const { put, url, pinned } = await fixture(t);
  await fs.mkdir(path.join(pinned, 'nested'));
  const bytes = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const name = 'žluťoučký #?.bin';
  assert.equal((await put(name, bytes, { cwd: pinned, path: 'nested' })).status, 200);
  const response = await fetch(url('/download', { cwd: pinned, path: `nested/${name}` }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('content-disposition'), /^attachment;.*filename\*=UTF-8''%C5/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await put('empty', Buffer.alloc(0))).status, 200);
  assert.equal((await (await fetch(url('/download', { path: 'empty' }))).arrayBuffer()).byteLength, 0);
  assert.deepEqual(await fs.readFile(path.join(pinned, 'nested', name)), bytes);
});

test('lists directories first, includes hidden files, hides escaping and broken symlinks', async t => {
  const { home, pinned, url } = await fixture(t);
  await fs.mkdir(path.join(home, 'z-folder'));
  await fs.writeFile(path.join(home, '.hidden'), 'hidden');
  await fs.symlink(pinned, path.join(home, 'outside'));
  await fs.symlink(path.join(home, 'missing'), path.join(home, 'broken'));
  assert.deepEqual((await (await fetch(url())).json()).data, [
    { name: 'z-folder', directory: true }, { name: '.hidden', directory: false },
  ]);
});

test('refuses overwrites, directory collisions and dangling symlink upload targets', async t => {
  const { home, put } = await fixture(t);
  await fs.writeFile(path.join(home, 'keep'), 'original');
  await fs.mkdir(path.join(home, 'folder'));
  await fs.symlink(path.join(home, 'missing'), path.join(home, 'link'));
  for (const name of ['keep', 'folder', 'link']) assert.equal((await put(name, 'replace')).status, 409);
  assert.equal(await fs.readFile(path.join(home, 'keep'), 'utf8'), 'original');
  assert.equal(await exists(path.join(home, 'missing')), false);
});

test('rejects invalid filenames, traversal, unknown roots and escaping symlinks', async t => {
  const { home, pinned, url, put } = await fixture(t);
  for (const name of ['', ' ', '.', '..', '../escape', '/absolute', 'a/b', 'a\\b', 'nul\0name']) {
    assert.equal((await put(name, 'data')).status, 400, name);
  }
  for (const relative of ['..', '../project']) {
    assert.equal((await fetch(url('', { path: relative }))).status, 403);
    assert.equal((await put('file', 'data', { path: relative })).status, 403);
  }
  assert.equal((await fetch(url('', { path: '/etc' }))).status, 400);
  assert.equal((await fetch(url('', { cwd: '/etc' }))).status, 403);
  await fs.symlink(pinned, path.join(home, 'outside'));
  await fs.writeFile(path.join(pinned, 'secret'), 'keep');
  assert.equal((await fetch(url('', { path: 'outside' }))).status, 403);
  assert.equal((await fetch(url('/download', { path: 'outside/secret' }))).status, 403);
  assert.equal((await put('file', 'data', { path: 'outside' })).status, 403);
});

test('allows symlinks inside the selected root and refuses directory downloads', async t => {
  const { home, url, put } = await fixture(t);
  await fs.mkdir(path.join(home, 'folder'));
  await fs.symlink(path.join(home, 'folder'), path.join(home, 'alias'));
  assert.equal((await put('new', 'data', { path: 'alias' })).status, 200);
  assert.equal(await (await fetch(url('/download', { path: 'alias/new' }))).text(), 'data');
  assert.equal((await fetch(url('/download', { path: 'folder' }))).status, 400);
  assert.equal((await fetch(url('/download', { path: 'missing' }))).status, 404);
});

test('all endpoints use the dashboard access guard and reject cross-origin requests', async t => {
  const { url, origin, home } = await fixture(t);
  for (const suffix of ['', '/roots', '/download', '/client.js', '/client.css']) {
    assert.equal((await fetch(url(suffix), { headers: { 'x-deny': '1' } })).status, 403);
    assert.equal((await fetch(url(suffix), { headers: { Origin: 'https://evil.example' } })).status, 403);
  }
  for (const headers of [
    { 'x-deny': '1' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
  ]) {
    assert.equal((await fetch(url('', { name: 'denied' }), {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: 'data',
    })).status, 403);
  }
  assert.equal(await exists(path.join(home, 'denied')), false);
  assert.equal((await fetch(url('/roots'), { headers: { Origin: origin } })).status, 200);
  // TLS reverse proxies may replace Host with the internal server's address.
  assert.equal((await fetch(url('/roots'), { headers: {
    Origin: 'https://dashboard.example', 'Sec-Fetch-Site': 'same-origin',
  } })).status, 200);
});

test('malformed session roots cannot authorize a request without cwd', async t => {
  const { origin, url, home, pinned } = await fixture(t, { sessionManager: { listAll: () => [{}, { cwd: '' }] } });
  assert.deepEqual((await (await fetch(url('/roots'))).json()).data.roots, [home, pinned]);
  assert.equal((await fetch(`${origin}/api/pocket-pi/files`)).status, 403);
});

test('enforces upload limits for declared and chunked bodies and cleans up partial files', async t => {
  const { home, url, put } = await fixture(t, { maxUploadBytes: 10 });
  assert.equal((await put('large', Buffer.alloc(11))).status, 413);
  const response = await fetch(url('', { name: 'chunked' }), {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, duplex: 'half',
    body: Readable.from([Buffer.alloc(8), Buffer.alloc(8)]),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /upload limit/);
  assert.deepEqual(await fs.readdir(home), []);
  assert.equal((await put('chunked', 'retry')).status, 200);
  assert.equal((await fetch(url('', { name: 'wrong-type' }), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).status, 415);
});

test('aborted uploads remove partial output and leave the name available', async t => {
  const { home, url, put } = await fixture(t);
  const request = http.request(url('', { name: 'aborted' }), {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
  });
  request.on('error', () => {});
  request.write(Buffer.alloc(1024));
  await eventually(() => exists(path.join(home, 'aborted')));
  request.destroy();
  await eventually(async () => !await exists(path.join(home, 'aborted')));
  assert.equal((await put('aborted', 'retry')).status, 200);
});
