#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { refreshLocations } = require('./refresh-locations');
const { writeJsonFile } = require('./json-store');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8765);
const useHttps = process.argv.includes('--https') || process.env.HTTPS === '1';
const maxBodyBytes = 20 * 1024 * 1024;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.cur': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// Only these top-level entries are served; the root also holds .certs/ and scripts/.
const publicEntries = new Set(['index.html', 'status.html', 'css', 'js', 'data', 'doc']);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        failed = true;
        chunks.length = 0;
        reject(httpError(413, 'JSON upload is too large'));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(httpError(400, 'Uploaded content is not valid JSON')); }
    });
    request.on('error', reject);
  });
}

// Blocks cross-site and DNS-rebinding requests to the write endpoints.
function checkTrustedRequest(request, requireJson) {
  const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (!allowedHosts.has(request.headers.host)) throw httpError(403, 'Unexpected Host header');
  const origin = request.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch (error) { throw httpError(403, 'Invalid Origin header'); }
    if (originHost !== request.headers.host) throw httpError(403, 'Cross-origin requests are not allowed');
  }
  if (requireJson && !/^application\/json\s*(;|$)/i.test(request.headers['content-type'] || '')) {
    throw httpError(415, 'Content-Type must be application/json');
  }
}

function validateLocationRecords(records, allowEmpty, allowApprovalOverlays) {
  if (!Array.isArray(records) || (!allowEmpty && !records.length)) throw new Error('Locations must be a non-empty JSON array');
  records.forEach((record) => {
    const hasIdentity = record && (record.provider || record.csp) && (record.regionId || record.code);
    const hasCoordinates = record && (record.coordinates || record.coord);
    const isApprovalOverlay = allowApprovalOverlays && record && Object.prototype.hasOwnProperty.call(record, 'companyAccessStatus');
    if (!hasIdentity || (!hasCoordinates && !isApprovalOverlay)) {
      throw new Error('Each location needs provider, regionId, and coordinates fields');
    }
  });
}

function resolveStaticPath(request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  } catch (error) {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`)) return null;
  const topLevel = path.relative(root, filePath).split(path.sep)[0];
  return publicEntries.has(topLevel) ? filePath : null;
}

function serveStatic(request, response) {
  const filePath = resolveStaticPath(request);
  if (!filePath) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
}

function handleError(response, error, fallbackStatus) {
  const status = error.status || fallbackStatus;
  if (status === 413) response.setHeader('Connection', 'close');
  sendJson(response, status, { error: error.message });
}

const requestHandler = (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${host}:${port}`).pathname;
  } catch (error) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  if (request.method === 'POST' && pathname === '/api/refresh-locations') {
    try { checkTrustedRequest(request, false); } catch (error) { handleError(response, error, 403); return; }
    refreshLocations().then((records) => {
      sendJson(response, 200, { generatedAt: new Date().toISOString(), count: records.length, records });
    }).catch((error) => {
      handleError(response, error, 500);
    });
    return;
  }
  if (request.method === 'POST' && (pathname === '/api/save-locations/cloud' || pathname === '/api/save-locations/customer')) {
    try { checkTrustedRequest(request, true); } catch (error) { handleError(response, error, 403); return; }
    const customer = pathname.endsWith('/customer');
    readJsonBody(request).then(async (payload) => {
      const records = customer && !Array.isArray(payload) ? payload.locations : payload;
      try {
        validateLocationRecords(records, customer, customer);
      } catch (error) {
        throw httpError(400, error.message);
      }
      const output = customer && !Array.isArray(payload)
        ? { customerName: String(payload.customerName || 'Customer').trim() || 'Customer', locations: records }
        : records;
      const filePath = path.join(root, 'data', customer ? 'locations.customer.json' : 'locations.csp.json');
      await writeJsonFile(filePath, output);
      sendJson(response, 200, { saved: true, file: path.relative(root, filePath), count: records.length });
    }).catch((error) => {
      handleError(response, error, 500);
    });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' });
    response.end('Method not allowed');
    return;
  }
  serveStatic(request, response);
};

let server;
if (useHttps) {
  const keyPath = path.resolve(process.env.TLS_KEY_PATH || path.join(root, '.certs', 'localhost-key.pem'));
  const certPath = path.resolve(process.env.TLS_CERT_PATH || path.join(root, '.certs', 'localhost-cert.pem'));
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('HTTPS certificate files were not found. Run: ./scripts/create-local-cert.sh');
    process.exit(1);
  }
  server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}

server.listen(port, host, () => {
  console.log(`CloudVendorMap running at ${useHttps ? 'https' : 'http'}://${host}:${port}/`);
  console.log('Refresh endpoint: POST /api/refresh-locations');
});
