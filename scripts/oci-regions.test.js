const test = require('node:test');
const assert = require('node:assert');
const { parseOracleRegionRows } = require('./oci-regions');

const row = (...cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
const source = 'https://example.test/regions';

test('parses a region row with an explicit location', () => {
  const html = `<table>${row('US East (Ashburn)', 'us-ashburn-1', 'Ashburn, United States', 'OC1', '3')}</table>`;
  const [record] = parseOracleRegionRows(html, source, () => {});
  assert.equal(record.code, 'us-ashburn-1');
  assert.equal(record.location, 'Ashburn');
  assert.equal(record.state, 'United States');
  assert.equal(record.AZzones, 3);
  assert.equal(record.coord, '39.0438,-77.4874');
});

test('falls back to the city in the region name and the known country', () => {
  const html = row('Germany Central (Frankfurt)', 'eu-frankfurt-1', 'OC1', '3');
  const [record] = parseOracleRegionRows(html, source, () => {});
  assert.equal(record.location, 'Frankfurt');
  assert.equal(record.state, 'Germany');
});

test('skips and warns about cities without coordinates', () => {
  const warnings = [];
  const html = row('Nowhere (Atlantis)', 'xx-atlantis-1', 'OC1', '1');
  const records = parseOracleRegionRows(html, source, (message) => warnings.push(message));
  assert.equal(records.length, 0);
  assert.match(warnings[0], /xx-atlantis-1/);
});

test('looks up the country through the normalized city key', () => {
  const warnings = [];
  const html = row('Somewhere (Kulai)', 'ap-kulai-1', 'OC1', '1');
  const [record] = parseOracleRegionRows(html, source, (message) => warnings.push(message));
  assert.equal(record.state, 'Malaysia');
  assert.equal(warnings.length, 0);
});
