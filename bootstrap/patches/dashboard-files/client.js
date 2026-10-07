// Served by the dashboard, not injected by Android: the same UI works in every browser.
(() => {
  if (document.getElementById('pocket-pi-files')) return;
  const base = '/api/pocket-pi/files';
  const dialog = document.createElement('dialog');
  dialog.id = 'pocket-pi-files';
  dialog.setAttribute('aria-labelledby', 'pocket-pi-files-title');
  dialog.innerHTML = `
    <h2 id="pocket-pi-files-title">Files</h2>
    <label>Folder <select aria-label="Folder"></select></label>
    <p data-path></p>
    <div class="file-actions">
      <button type="button" data-up>Up</button>
      <button type="button" data-upload>Upload</button>
      <button type="button" data-refresh>Refresh</button>
      <input type="file" hidden>
    </div>
    <p data-limit></p>
    <p role="status" aria-live="polite"></p>
    <ul aria-label="Files"></ul>
    <button type="button" data-close>Close</button>`;
  document.body.appendChild(dialog);
  const select = dialog.querySelector('select');
  const status = dialog.querySelector('[role="status"]');
  const list = dialog.querySelector('ul');
  const input = dialog.querySelector('input');
  const up = dialog.querySelector('[data-up]');
  const close = dialog.querySelector('[data-close]');
  let directory = '';
  let limit = 0;
  let busy = false;
  let uploading = false;
  let controller;

  function setBusy(value) {
    busy = value;
    select.disabled = value;
    for (const button of dialog.querySelectorAll('.file-actions button')) button.disabled = value;
    up.disabled = value || !directory;
    close.disabled = uploading;
    dialog.setAttribute('aria-busy', String(value));
  }
  function url(suffix = '', extra = {}) {
    return `${base}${suffix}?${new URLSearchParams({ cwd: select.value, path: directory, ...extra })}`;
  }
  async function json(address, options = {}) {
    const { signal } = controller;
    const response = await fetch(address, { credentials: 'same-origin', ...options, signal });
    const body = await response.json();
    signal.throwIfAborted();
    if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
    return body.data;
  }
  async function run(action) {
    if (busy) return;
    const active = controller = new AbortController();
    setBusy(true);
    status.textContent = uploading ? 'Uploading…' : 'Loading…';
    try {
      await action();
    } catch (error) {
      if (!active.signal.aborted) status.textContent = error.message;
    } finally {
      if (controller === active) {
        uploading = false;
        setBusy(false);
      }
    }
  }
  async function refresh() {
    list.replaceChildren();
    dialog.querySelector('[data-path]').textContent = directory || '.';
    const entries = await json(url());
    for (const entry of entries) {
      const item = document.createElement('li');
      const control = document.createElement(entry.directory ? 'button' : 'a');
      control.textContent = entry.name + (entry.directory ? '/' : '');
      const child = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.directory) {
        control.type = 'button';
        control.onclick = () => run(async () => { directory = child; await refresh(); });
      } else {
        control.href = url('/download', { path: child });
        control.download = entry.name;
        control.title = `Download ${entry.name}`;
        control.onclick = event => { if (busy) event.preventDefault(); };
      }
      item.appendChild(control);
      list.appendChild(item);
    }
    status.textContent = entries.length ? 'Tap a file to download it.' : 'This folder is empty.';
  }
  async function open() {
    if (dialog.open) return;
    dialog.showModal();
    await run(async () => {
      const data = await json(`${base}/roots`);
      const previous = select.value;
      select.replaceChildren();
      for (const root of data.roots) {
        const option = document.createElement('option');
        option.value = option.textContent = root;
        select.appendChild(option);
      }
      if (data.roots.includes(previous)) select.value = previous;
      else directory = '';
      limit = data.maxUploadBytes;
      dialog.querySelector('[data-limit]').textContent = `Uploads: up to ${Math.floor(limit / 1024 / 1024)} MiB. Existing files are never overwritten.`;
      await refresh();
    });
  }
  select.onchange = () => run(async () => { directory = ''; await refresh(); });
  up.onclick = () => run(async () => { directory = directory.split('/').slice(0, -1).join('/'); await refresh(); });
  dialog.querySelector('[data-refresh]').onclick = () => run(refresh);
  dialog.querySelector('[data-upload]').onclick = () => input.click();
  input.onchange = () => {
    const file = input.files[0];
    input.value = '';
    if (!file || busy) return;
    if (file.size > limit) { status.textContent = 'File exceeds the upload limit'; return; }
    uploading = true;
    run(async () => {
      await json(url('', { name: file.name }), {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      await refresh();
      status.textContent = `Uploaded ${file.name}`;
    });
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (uploading) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    controller?.abort();
    controller = null;
    setBusy(false);
  });

  // The dashboard is a prebuilt dependency. Use its stable toolbar test ID,
  // without altering minified bundles or guessing paths from shortened labels.
  function addButtons() {
    document.querySelectorAll('[data-testid="pin-dir-dialog-btn"]').forEach(pin => {
      const toolbar = pin.parentElement;
      if (toolbar.querySelector('[data-pocketpi-files]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Files';
      button.title = 'Upload and download files';
      button.className = pin.className;
      button.setAttribute('data-pocketpi-files', '');
      button.onclick = open;
      toolbar.appendChild(button);
    });
  }
  new MutationObserver(addButtons).observe(document.body, { childList: true, subtree: true });
  addButtons();
})();
