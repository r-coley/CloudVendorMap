#!/usr/bin/env node

/*
 * Merge provider-sourced records with company-maintained fields.
 * Manual fields are keyed by provider:regionId and are never discarded.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'js', 'csp.js');
const manualPath = path.join(root, 'data', 'provider-locations.manual.json');
const generatedPath = path.join(root, 'data', 'provider-locations.generated.json');

function readCspRecords() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return context.CSP;
}

function parseCoordinates(value) {
  const [lat, lon] = String(value || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function keyFor(record) {
  return `${record.provider}:${record.regionId}`;
}

function normalize(record) {
  const normalized = {
    provider: record.csp,
    regionId: record.code,
    regionName: record.region,
    location: record.location,
    country: record.state,
    coordinates: parseCoordinates(record.coord),
    status: record.status || (/^future$/i.test(record.opened) ? 'planned' : 'live'),
    zones: Number(record.AZzones || record.Azones || 0),
    availabilityZones: record.availabilityZones || record.azLocations || [],
    sourceUrl: record.source || null,
    lastVerified: record.lastVerified || null
  };
  if (record.deploymentType) normalized.deploymentType = record.deploymentType;
  return normalized;
}

const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

function refreshLocations() {
  const generated = readCspRecords().map(normalize);
  const generatedKeys = new Set(generated.map(keyFor));

  // Manual-only locations are retained, which supports private-cloud records such as ALI.
  for (const [key, overrides] of Object.entries(manual)) {
    if (generatedKeys.has(key)) continue;
    const separator = key.indexOf(':');
    if (separator < 1) throw new Error(`Invalid manual location key: ${key}`);
    const provider = key.slice(0, separator);
    const regionId = key.slice(separator + 1);
    generated.push({
      provider,
      regionId,
      regionName: overrides.regionName || regionId,
      location: overrides.location || null,
      country: overrides.country || null,
      coordinates: overrides.coordinates || null,
      status: overrides.status || 'unknown',
      zones: Number(overrides.zones || 0),
      availabilityZones: overrides.availabilityZones || overrides.azLocations || [],
      sourceUrl: overrides.sourceUrl || null,
      lastVerified: overrides.lastVerified || null,
      deploymentType: overrides.deploymentType || 'private-cloud'
    });
  }

  const merged = generated.map((record) => ({ ...record, ...(manual[keyFor(record)] || {}) }));
  fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
  fs.writeFileSync(generatedPath, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

if (require.main === module) {
  const merged = refreshLocations();
  console.log(`Wrote ${merged.length} locations to ${path.relative(root, generatedPath)}`);
}

module.exports = { refreshLocations };
