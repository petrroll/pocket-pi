import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { fixture, eventually } from './helpers.mjs';

const script = await fs.readFile(new URL('../client.js', import.meta.url), 'utf8');
const toolbar = '<div><button data-testid="pin-dir-dialog-btn">Folder</button></div>';

async function browser(t) {
  const server = await fixture(t);
  const dom = new JSDOM('<body><main></main></body>', { runScripts: 'dangerously', url: server.origin });
  const window = dom.window;
  window.AbortController = globalThis.AbortController;
  const observers = [];
  const Observer = window.MutationObserver;
  window.MutationObserver = class extends Observer {
    constructor(callback) { super(callback); observers.push(this); }
  };
  window.fetch = (url, options) => fetch(new URL(url, server.origin), options);
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.eval(script);
  window.document.querySelector('main').innerHTML = toolbar;
  await eventually(() => window.document.querySelector('[data-pocketpi-files]'));
  t.after(() => { observers.forEach(observer => observer.disconnect()); window.close(); });
  const dialog = window.document.getElementById('pocket-pi-files');
  const status = () => dialog.querySelector('[role="status"]').textContent;
  const idle = () => eventually(() => dialog.getAttribute('aria-busy') === 'false');
  const choose = file => {
    const input = dialog.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
    input.dispatchEvent(new window.Event('change'));
  };
  return { ...server, window, dialog, status, idle, choose };
}

test('toolbar survives SPA remounts and repeated script loads without a native bridge', async t => {
  const { window, dialog, idle } = await browser(t);
  assert.equal(window.PocketPi, undefined);
  window.eval(script);
  assert.equal(window.document.querySelectorAll('#pocket-pi-files').length, 1);
  window.document.querySelector('main').innerHTML = toolbar;
  await eventually(() => window.document.querySelector('[data-pocketpi-files]'));
  assert.equal(window.document.querySelectorAll('[data-pocketpi-files]').length, 1);
  window.document.querySelector('[data-pocketpi-files]').click();
  await idle();
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('select').options.length, 2);
  dialog.querySelector('[data-close]').click();
  assert.equal(dialog.open, false);
});

test('web UI uploads and downloads in selected folders, handles conflicts and cancellation', async t => {
  const { window, dialog, idle, choose, status, home, pinned } = await browser(t);
  await fs.mkdir(path.join(pinned, 'nested'));
  window.document.querySelector('[data-pocketpi-files]').click();
  await idle();
  const select = dialog.querySelector('select');
  select.value = pinned;
  select.dispatchEvent(new window.Event('change'));
  await idle();
  dialog.querySelector('li button').click();
  await idle();
  assert.equal(dialog.querySelector('[data-path]').textContent, 'nested');
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  const name = 'žluťoučký <b>.bin';
  choose(new File([bytes], name));
  await idle();
  assert.equal(status(), `Uploaded ${name}`);
  assert.deepEqual(await fs.readFile(path.join(pinned, 'nested', name)), Buffer.from(bytes));
  assert.deepEqual(await fs.readdir(home), []);
  assert.equal(dialog.querySelectorAll('li b').length, 0); // names are text, never HTML
  const link = dialog.querySelector('li a');
  assert.equal(link.download, name);
  assert.deepEqual(Buffer.from(await (await fetch(link.href)).arrayBuffer()), Buffer.from(bytes));
  choose(new File(['replacement'], name));
  await idle();
  assert.match(status(), /already exists/);
  assert.deepEqual(await fs.readFile(path.join(pinned, 'nested', name)), Buffer.from(bytes));
  choose(null);
  assert.equal(dialog.getAttribute('aria-busy'), 'false');
  dialog.querySelector('[data-up]').click();
  await idle();
  assert.equal(dialog.querySelector('[data-path]').textContent, '.');
  assert.equal(dialog.querySelector('[data-up]').disabled, true);
});

test('refresh loads files created by Pi and reports failures without leaving controls locked', async t => {
  const { window, dialog, idle, home, status } = await browser(t);
  window.document.querySelector('[data-pocketpi-files]').click();
  await idle();
  await fs.writeFile(path.join(home, 'new.txt'), 'hello');
  dialog.querySelector('[data-refresh]').click();
  await idle();
  assert.equal(dialog.querySelector('li a').textContent, 'new.txt');
  const original = window.fetch;
  window.fetch = async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: 'Access denied' }) });
  dialog.querySelector('[data-refresh]').click();
  await idle();
  assert.equal(status(), 'Access denied');
  assert.equal(dialog.querySelector('[data-close]').disabled, false);
  window.fetch = original;
  dialog.querySelector('[data-refresh]').click();
  await idle();
  assert.equal(dialog.querySelector('li a').textContent, 'new.txt');
});
