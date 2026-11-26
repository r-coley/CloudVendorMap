#!/usr/bin/env node

/*
 * Merge provider-sourced records with company-maintained fields.
 * Manual fields are keyed by provider:regionId and are never discarded.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fetchOracleRegions } = require('./oci-regions');

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

async function refreshLocations() {
  const sourceRecords = readCspRecords();
  const cached = JSON.parse(fs.readFileSync(generatedPath, 'utf8'));
  let ociRecords;
  try {
    ociRecords = await fetchOracleRegions();
    console.log(`Loaded ${ociRecords.length} OCI regions from Oracle documentation.`);
  } catch (error) {
    ociRecords = cached.filter((record) => record.provider === 'OCI').map((record) => ({
      csp: record.provider, area: record.area, region: record.regionName, code: record.regionId,
      AZzones: record.zones, Lzones: 0, Wzones: 0, location: record.location, state: record.country,
      opened: record.status, status: record.status, source: record.sourceUrl,
      lastVerified: record.lastVerified, coord: record.coordinates && `${record.coordinates.lat},${record.coordinates.lon}`
    }));
    console.warn(`Using cached OCI data: ${error.message}`);
  }
  const generated = sourceRecords.filter((record) => record.csp !== 'OCI').concat(ociRecords).map(normalize);
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
  refreshLocations().then((merged) => {
    console.log(`Wrote ${merged.length} locations to ${path.relative(root, generatedPath)}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { refreshLocations };
