# Shared file transfers

The Folders **Files** button, folder browser and upload/download endpoints live in
`bootstrap/patches/dashboard-files/`. They are served by the dashboard to **every
client**, including desktop browsers, mobile browsers and the Android WebView.
There is no Android-only file browser or JavaScript filesystem bridge.

The UI offers Pi home plus the dashboard's pinned/session folders. The server
checks the selected root on every request and confines paths, including symlinks,
to that root. It reuses the dashboard's network/authentication guard and rejects
cross-origin requests. Uploads stream to exclusively created files (no overwrite),
are limited to 100 MiB, and remove partial output on failed/disconnected requests.
Downloads stream as attachments; neither direction buffers whole files in memory.

## Packaging and standalone web installations

The dashboard is a prebuilt npm dependency, not source maintained in this repo.
`install.mjs` adds a route-registration call to **both server copies**: the CLI's
bundled source and the published `pi-dashboard-server` package used by Pi's
extension auto-start. It adds script/CSS references to the **HTML entry point**
resolved by each server, updating precompressed HTML as well. Three small runtime
files are copied alongside each server. Unchanged files are left alone; changes
are atomic replacements. No minified bundles are rewritten or rebuilt.

The toolbar hook targets `pin-dir-dialog-btn`. The root dashboard package is
pinned to 0.5.3, but npm's compatible transitive ranges currently resolve server/web
0.5.4; both layouts are covered. This is not a transitive dependency lock.

Pocket Pi applies this during postinstall and **before starting either child**
(the dashboard CLI or Pi, whose extension can auto-start another server).
The APK also carries the small patch payload separately so an app upgrade can
refresh it without reinstalling npm packages or touching user files.

For a standalone web-dashboard installation, apply the same integration and
restart the dashboard (stop it before modifying an active installation):

```sh
node bootstrap/patches/dashboard-files/install.mjs \
  "$(npm root -g)/@blackbelt-technology/pi-agent-dashboard"
```

Use the actual package directory for a local or custom-prefix npm installation.
The installer is idempotent and fails on an unsupported source layout. Reapply it
after npm replaces the dashboard/web packages. Remote browsers still need the
dashboard's normal authentication/trusted-network configuration; this feature
does not open another server or bypass those controls.

Android only supplies WebView platform plumbing: `onShowFileChooser` returns
user-selected content URIs to the standard HTML file input, and a download listener
uses Android's save dialog for the shared HTTP download endpoint. The download
copy sends the dashboard cookie only to that localhost endpoint and never follows
redirects. Android storage permissions are not required.

## Automated tests

From the repository root:

```sh
(cd bootstrap/patches/dashboard-files && npm ci --ignore-scripts && npm test)
(cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug)
```

Node tests exercise the real HTTP routes, streaming binary/empty/Unicode files,
root selection, traversal/symlink denial, conflicts, authentication guard/origin
checks, limits, aborted-upload cleanup, both installed server layouts, installer
idempotence/unchanged timestamps/compressed HTML,
and the browser UI without any `PocketPi` native object. JVM tests cover Android's
URL restriction, binary streaming, cookies and redirect/error handling.

## Browser and Android checklist

1. Open the dashboard in a normal browser, then in the Android app. **Files** must
   appear beside **Folder** once. Filter folders, switch sessions and return,
   reload the page, and confirm it survives sidebar remounts without duplicates.
2. Choose a pinned/session folder, enter a subfolder, and upload a text file, an
   image/binary file, an empty file and a Unicode filename. Verify bytes on disk.
   Upload the same name again: the original must remain unchanged.
3. Download each file and compare bytes. In Android, verify the system save dialog
   and cancel both upload/save pickers; no operation should start on cancellation.
   Rotate while the save picker is open and complete it. A WebView upload picker
   cancelled by activity recreation can be reopened from the refreshed page.
4. Use **Up** and **Refresh**. Check empty folders and files created by Pi. A symlink
   inside the selected root should work; one escaping it must not be listed.
5. Upload a large file and one over 100 MiB. The UI should remain responsive and
   report the limit/error. Disconnect during an upload and check partial cleanup.
6. Verify remote authenticated browser access, and that denied/expired access
   cannot list, upload or download files. Check the toolbar hook again whenever
   the bundled dashboard is upgraded.
