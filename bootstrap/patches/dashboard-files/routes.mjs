import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const base = "/api/pocket-pi/files";
const assets = new Map(["client.js", "client.css"].map(name => [
  name, readFileSync(new URL(name, import.meta.url), "utf8"),
]));

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode });
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolve(root, relative = "") {
  if (typeof relative !== "string" || relative.includes("\0") || path.isAbsolute(relative)) {
    fail(400, "Expected a relative file path");
  }
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) fail(403, "Path is outside the selected folder");
  const real = await fs.realpath(candidate);
  if (!inside(root, real)) fail(403, "Path is outside the selected folder");
  return real;
}

/** Installed alongside the dashboard's own routes; uses its existing access guard. */
export function registerPocketPiFiles(fastify, {
  sessionManager, preferencesStore, networkGuard,
  home = os.homedir(), maxUploadBytes = MAX_UPLOAD_BYTES,
}) {
  const roots = () => [...new Set([
    home,
    ...preferencesStore.getPinnedDirectories(),
    ...sessionManager.listAll().map(session => session.cwd),
  ].filter(root => typeof root === "string" && root.length > 0))];
  async function selectedRoot(request) {
    if (!roots().includes(request.query.cwd)) fail(403, "Unknown folder");
    return fs.realpath(request.query.cwd);
  }

  fastify.register(async app => {
    // Authorize before consuming any upload bytes. Inherit dashboard authentication;
    // additionally reject cross-origin requests, including localhost CSRF attempts.
    app.addHook("onRequest", networkGuard);
    app.addHook("onRequest", async request => {
      const site = request.headers["sec-fetch-site"];
      if (site && !["same-origin", "none"].includes(site)) fail(403, "Cross-origin request denied");
      const origin = request.headers.origin;
      if (origin) {
        let parsed;
        try { parsed = new URL(origin); } catch { fail(403, "Cross-origin request denied"); }
        // Browser-controlled Fetch Metadata survives reverse proxies which rewrite
        // Host. Older clients without it must provide a matching Origin/Host.
        if (!["http:", "https:"].includes(parsed.protocol) || (!site && parsed.host !== request.headers.host)) {
          fail(403, "Cross-origin request denied");
        }
      }
    });
    app.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      return payload;
    });
    app.setErrorHandler((error, request, reply) => {
      // Keep the HTTP connection usable after rejecting a streaming upload.
      request.raw.resume();
      const codes = { ENOENT: 404, ENOTDIR: 404, EEXIST: 409, EACCES: 403, EPERM: 403 };
      const status = error.statusCode ?? codes[error.code] ?? 500;
      const messages = { 404: "File or folder not found", 409: "A file with this name already exists", 403: "Access denied" };
      reply.code(status).send({ success: false, error: error.statusCode ? error.message : messages[status] ?? "File operation failed" });
    });
    app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));

    for (const [name, content] of assets) {
      app.get(`${base}/${name}`, (_request, reply) => reply
        .type(name.endsWith(".js") ? "text/javascript" : "text/css").send(content));
    }
    app.get(`${base}/roots`, async () => ({ success: true, data: { roots: roots(), maxUploadBytes } }));
    app.get(base, async request => {
      const root = await selectedRoot(request);
      const directory = await resolve(root, request.query.path);
      const names = await fs.readdir(directory);
      const entries = [];
      for (const name of names) {
        try {
          const file = await fs.realpath(path.join(directory, name));
          if (!inside(root, file)) continue;
          const stat = await fs.stat(file);
          if (stat.isDirectory() || stat.isFile()) entries.push({ name, directory: stat.isDirectory() });
        } catch (error) {
          if (!["ENOENT", "EACCES", "EPERM", "ELOOP"].includes(error.code)) throw error;
        }
      }
      entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
      return { success: true, data: entries };
    });
    app.put(base, async request => {
      if (request.headers["content-type"] !== "application/octet-stream") fail(415, "Expected application/octet-stream");
      if (Number(request.headers["content-length"]) > maxUploadBytes) fail(413, "File exceeds the upload limit");
      const root = await selectedRoot(request);
      const directory = await resolve(root, request.query.path);
      if (!(await fs.stat(directory)).isDirectory()) fail(400, "Upload destination is not a folder");
      const { name } = request.query;
      if (typeof name !== "string" || !name.trim() || name === "." || name === ".." || /[/\\\0]/.test(name)) {
        fail(400, "Invalid file name");
      }
      const destination = path.join(directory, name);
      // Exclusive creation refuses both existing files and dangling symlinks.
      const file = await fs.open(destination, "wx", 0o600);
      try {
        let size = 0;
        // Unlike pipeline(), this does not destroy the HTTP socket on a size-limit
        // error, so the client receives the 413 response rather than a network error.
        for await (const chunk of request.body.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > maxUploadBytes) fail(413, "File exceeds the upload limit");
          await file.writeFile(chunk);
        }
        return { success: true };
      } catch (error) {
        await fs.unlink(destination);
        throw error;
      } finally {
        await file.close();
      }
    });
    app.get(`${base}/download`, { compress: false }, async (request, reply) => {
      const root = await selectedRoot(request);
      const target = await resolve(root, request.query.path);
      const stat = await fs.stat(target);
      if (!stat.isFile()) fail(400, "Not a regular file");
      const file = await fs.open(target, "r");
      const name = path.basename(request.query.path);
      const encoded = encodeURIComponent(name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      reply.type("application/octet-stream");
      reply.header("Content-Length", stat.size);
      reply.header("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encoded}`);
      return reply.send(file.createReadStream());
    });
  });
}
