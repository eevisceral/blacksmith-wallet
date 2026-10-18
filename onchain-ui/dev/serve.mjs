/** Shared static-file server for local playground + Chrome smokes. */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, relative, resolve } from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ server, port: p, origin: `http://${host}:${p}` });
    });
  });
}

export function serveHtml(html, { port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(html);
  });
  return listen(server, port, host);
}

export function serveUiRoot({
  uiRoot,
  port = 0,
  host = '127.0.0.1',
  patchIndexHtml,
  extraRoutes,
} = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}`);
    if (extraRoutes?.(req, res, url)) return;
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (rel === '/SKILL.md') {
      const skill = resolve(uiRoot, '..', 'SKILL.md');
      if (existsSync(skill)) {
        res.writeHead(200, {
          'content-type': MIME['.md'],
          'cache-control': 'no-store',
        });
        res.end(readFileSync(skill));
        return;
      }
    }
    const file = normalize(join(uiRoot, rel));
    if (relative(uiRoot, file).startsWith('..') || !existsSync(file)) {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    let body = readFileSync(file);
    if ((rel === '/index.html' || rel === '/dist/index.html') && patchIndexHtml) {
      body = Buffer.from(patchIndexHtml(body.toString('utf8')));
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  return listen(server, port, host);
}
