#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { refreshLocations } = require('./refresh-locations');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8765);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.cur': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/refresh-locations') {
    try {
      const records = refreshLocations();
      sendJson(response, 200, { generatedAt: new Date().toISOString(), count: records.length, records });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' });
    response.end('Method not allowed');
    return;
  }
  serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`CloudVendorMap running at http://${host}:${port}/`);
  console.log('Refresh endpoint: POST /api/refresh-locations');
});
