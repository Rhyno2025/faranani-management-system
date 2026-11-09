// ---------------------------------------------------------------------------
// Serves the GitHub Pages demo build locally at the same sub-path Pages uses,
// so routing and asset URLs can be checked before pushing.
//
//   PAGES_BASE_PATH=1 VITE_DEMO=1 npm run build
//   cp dist/index.html dist/404.html
//   node scripts/preview-demo-server.mjs        # http://localhost:4173/faranani-management-system/
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PREFIX = '/faranani-management-system';
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing — run the build first.');
  process.exit(1);
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (!urlPath.startsWith(PREFIX)) {
    res.writeHead(302, { Location: `${PREFIX}/` });
    return res.end();
  }
  urlPath = urlPath.slice(PREFIX.length);
  if (urlPath === '' || urlPath.endsWith('/')) urlPath += 'index.html';

  let file = path.join(DIST, urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    return res.end(fs.readFileSync(path.join(DIST, '404.html')));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`Demo build: http://localhost:${PORT}${PREFIX}/`);
});
