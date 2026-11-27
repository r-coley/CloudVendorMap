#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { refreshLocations } = require('./refresh-locations');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8765);
const useHttps = process.argv.includes('--https') || process.env.HTTPS === '1';
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

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) reject(new Error('JSON upload is too large'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error('Uploaded content is not valid JSON')); }
    });
    request.on('error', reject);
  });
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

async function writeJsonFile(filePath, payload) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.promises.rename(temporaryPath, filePath);
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

const requestHandler = (request, response) => {
  if (request.method === 'POST' && request.url === '/api/refresh-locations') {
    refreshLocations().then((records) => {
      sendJson(response, 200, { generatedAt: new Date().toISOString(), count: records.length, records });
    }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
    return;
  }
  if (request.method === 'POST' && (request.url === '/api/save-locations/cloud' || request.url === '/api/save-locations/customer')) {
    const customer = request.url.endsWith('/customer');
    readJsonBody(request).then(async (payload) => {
      const records = customer && !Array.isArray(payload) ? payload.locations : payload;
      validateLocationRecords(records, customer, customer);
      const output = customer && !Array.isArray(payload)
        ? { customerName: String(payload.customerName || 'Customer').trim() || 'Customer', locations: records }
        : records;
      const filePath = path.join(root, 'data', customer ? 'locations.customer.json' : 'locations.csp.json');
      await writeJsonFile(filePath, output);
      sendJson(response, 200, { saved: true, file: path.relative(root, filePath), count: records.length });
    }).catch((error) => {
      sendJson(response, 400, { error: error.message });
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
