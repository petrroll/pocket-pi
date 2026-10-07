#!/usr/bin/env node
// Patch source-level registration and HTML, never minified frontend bundles.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const importLine = 'import { registerPocketPiFiles } from "./pocket-pi-files/routes.mjs";';
const call = '  registerPocketPiFiles(fastify, { sessionManager, preferencesStore, networkGuard });';
const tags = '<link rel="stylesheet" href="/api/pocket-pi/files/client.css">\n<script defer src="/api/pocket-pi/files/client.js"></script>';

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error("Unsupported dashboard layout: expected one integration point");
  return text.replace(before, after);
}

function writeChanged(file, content) {
  const bytes = Buffer.from(content);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, {
      flag: "wx", mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o644,
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function installDashboardFiles(packageDir) {
  const root = path.resolve(packageDir);
  const servers = [path.join(root, "packages/server/src/server.ts")];
  // pi-dashboard's CLI uses the bundled source, but the Pi extension's auto-start
  // resolves the separately published server package. Both must be patched.
  try {
    const serverPackage = createRequire(path.join(root, "package.json"))
      .resolve("@blackbelt-technology/pi-dashboard-server/package.json");
    servers.push(path.join(path.dirname(serverPackage), "src/server.ts"));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }

  const updates = new Map();
  for (const server of new Set(servers.map(file => fs.realpathSync(file)))) {
    let source = fs.readFileSync(server, "utf8");
    if (!source.includes(importLine)) {
      source = importLine + "\n" + replaceOnce(source,
        '  registerFileRoutes(fastify, { sessionManager, preferencesStore, networkGuard });',
        '  registerFileRoutes(fastify, { sessionManager, preferencesStore, networkGuard });\n' + call);
    } else if (source.split(importLine).length !== 2 || source.split(call).length !== 2) {
      throw new Error("Incomplete dashboard file-transfer patch; reinstall the dashboard and retry");
    }
    for (const name of ["client.js", "client.css", "routes.mjs"]) {
      updates.set(path.join(path.dirname(server), "pocket-pi-files", name), fs.readFileSync(path.join(here, name)));
    }
    updates.set(server, source);
    const web = path.dirname(createRequire(server).resolve("@blackbelt-technology/pi-dashboard-web/package.json"));
    const index = path.join(web, "dist/index.html");
    let html = fs.readFileSync(index, "utf8");
    if (!html.includes(tags)) html = replaceOnce(html, "</head>", tags + "\n</head>");
    updates.set(index, html);
    for (const [suffix, compress] of [[".gz", gzipSync], [".br", brotliCompressSync]]) {
      if (fs.existsSync(index + suffix)) updates.set(index + suffix, compress(html));
    }
  }
  // Validate every layout before changing anything. Unchanged files retain their
  // timestamps; changed files are atomically replaced, never temporarily truncated.
  for (const [file, content] of updates) writeChanged(file, content);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: node install.mjs <installed pi-agent-dashboard directory>");
  installDashboardFiles(directory);
  console.log("Pocket Pi file transfers installed; restart the dashboard to apply");
}
