// pi-agent-dashboard 0.5.3's Folders toolbar. Keep file access in native UI,
// rather than exposing filesystem methods or guessing paths from truncated labels.
(() => {
  if (window.pocketPiFolderFiles) return;
  window.pocketPiFolderFiles = true;
  function addButton() {
    document.querySelectorAll('[data-testid="pin-dir-dialog-btn"]').forEach(pin => {
      const toolbar = pin.parentElement;
      if (toolbar.querySelector('[data-pocketpi-files]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Files';
      button.title = 'Upload and download files';
      button.className = pin.className;
      button.setAttribute('data-pocketpi-files', '');
      button.addEventListener('click', event => {
        event.stopPropagation();
        PocketPi.openFiles();
      });
      toolbar.appendChild(button);
    });
  }
  new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
  addButton();
})();
