// Servidor local que imita a Vercel: archivos de public/, la reescritura de
// /liga/:id y la función de api/liga.js. Uso: npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as liga from './api/liga.js';

const root = path.resolve('public');
const port = Number(process.env.PORT) || 3000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function callApi(req, url) {
  const handler = liga[req.method];
  if (!handler) return new Response('Method Not Allowed', { status: 405 });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = Object.entries(req.headers).filter(([, v]) => typeof v === 'string');
  return handler(new Request(url, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  }));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/api/liga') {
    const response = await callApi(req, url);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const isPage = url.pathname === '/' || /^\/liga\/[^/]+\/?$/.test(url.pathname);
  const file = path.join(root, isPage ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Liga de pádel en http://localhost:${port}`));
