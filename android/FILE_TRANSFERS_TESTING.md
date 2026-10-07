# File-transfer checks

Run `./gradlew :app:testDebugUnitTest :app:assembleDebug` from `android/`.
The JVM tests cover binary/empty files, nested destinations, conflicts, invalid
names, traversal, symlinks and cleanup after interrupted reads.

On an Android device with the dashboard running:

1. Open the Folders view. **Files** should appear next to **Folder**, exactly once.
   Filter folders, collapse/expand them, switch to a session and back, and reload
   the page. The button should remain available without duplicates.
2. Tap **Files**. Navigate into a folder under Pi home and **Upload** a document
   using the system picker. Verify its name and contents from Pi. Repeat with an
   image/binary file, an empty file and a Unicode filename.
3. Upload the same name again. An error should appear, and the original should be
   unchanged. Cancel the picker and verify that the dialog becomes usable again.
4. Tap a file, pick a save destination, and compare its bytes with the original.
   Cancel the save dialog; no transfer should occur.
5. Rotate the device while each system picker is open, then complete or cancel.
   The selected source/destination folder should be retained.
6. Create files through Pi and tap **Refresh**. Test an empty folder, a nested
   folder, a symlink inside home, and a symlink pointing outside home. The outside
   link must not be listed; **Up** must stop at Pi home.
7. Try a large file: the UI should stay responsive while copying and show an
   indeterminate progress indicator. A provider read/write failure must show an
   error instead of a success message.

The toolbar selector in `app/src/main/assets/folder-files.js` targets the bundled
pi-agent-dashboard 0.5.3 `pin-dir-dialog-btn`. Recheck step 1 when upgrading the
dashboard; no dashboard source or minified bundle is patched.
