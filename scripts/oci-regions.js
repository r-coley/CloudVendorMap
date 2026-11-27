const ORACLE_REGION_SOURCES = [
  'https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm',
  'https://docs.oracle.com/en-us/iaas/Content/gov-cloud/govfedramp.htm',
  'https://docs.oracle.com/en-us/iaas/Content/gov-cloud/govfeddod.htm',
  'https://docs.oracle.com/en-us/iaas/Content/uk-sovereign-cloud/home.htm',
  'https://docs.oracle.com/en-us/iaas/Content/gov-cloud/ausgov.htm',
  'https://docs.oracle.com/en-us/iaas/Content/sovereign-cloud/eu-sovereign-cloud.htm'
];

const FETCH_TIMEOUT_MS = 15000;

const CITY_COORDINATES = {
  Ashburn: [39.0438, -77.4874], "Abu Dhabi": [24.4539, 54.3773], Amsterdam: [52.3676, 4.9041],
  Batam: [1.0456, 104.0305], Bogota: [4.7110, -74.0721], Brisbane: [-27.4698, 153.0251],
  Canberra: [-35.2809, 149.1300], Casablanca: [33.5731, -7.5898], Chicago: [41.8781, -87.6298],
  Chuncheon: [37.8813, 127.7298], Frankfurt: [50.1109, 8.6821], Hyderabad: [17.3850, 78.4867],
  Jeddah: [21.4858, 39.1925], Jerusalem: [31.7683, 35.2137], Johannesburg: [-26.2041, 28.0473],
  Kulai: [1.6561, 103.6032], London: [51.5072, -0.1276], Madrid: [40.4168, -3.7038],
  Marseille: [43.2965, 5.3698], Melbourne: [-37.8136, 144.9631], Milan: [45.4642, 9.1900],
  Monterrey: [25.6866, -100.3161], Montreal: [45.5019, -73.5674], Mumbai: [19.0760, 72.8777],
  Newport: [51.5842, -2.9977], Paris: [48.8566, 2.3522], Phoenix: [33.4484, -112.0740],
  Queretaro: [20.5888, -100.3899], Riyadh: [24.7136, 46.6753], SanJose: [37.3382, -121.8863],
  Santiago: [-33.4489, -70.6693], SaoPaulo: [-23.5558, -46.6396], Seoul: [37.5665, 126.9780],
  Singapore: [1.3521, 103.8198], Stockholm: [59.3293, 18.0686], Sydney: [-33.8688, 151.2093],
  Tokyo: [35.6762, 139.6503], Toronto: [43.6532, -79.3832], Turin: [45.0703, 7.6869],
  Valparaiso: [-33.0472, -71.6127], Vinhedo: [-23.0295, -46.9753], Zurich: [47.3769, 8.5417]
};

const CITY_COUNTRIES = {
  AbuDhabi: 'UAE', Ashburn: 'United States', Amsterdam: 'Netherlands', Batam: 'Indonesia',
  Bogota: 'Colombia', Brisbane: 'Australia', Canberra: 'Australia', Casablanca: 'Morocco',
  Chicago: 'United States', Chuncheon: 'South Korea', Frankfurt: 'Germany', Hyderabad: 'India',
  Jeddah: 'Saudi Arabia', Jerusalem: 'Israel', Johannesburg: 'South Africa', Kulai: 'Malaysia',
  London: 'United Kingdom', Madrid: 'Spain', Marseille: 'France', Melbourne: 'Australia',
  Milan: 'Italy', Monterrey: 'Mexico', Montreal: 'Canada', Mumbai: 'India', Newport: 'United Kingdom',
  Paris: 'France', Phoenix: 'United States', Queretaro: 'Mexico', Riyadh: 'Saudi Arabia',
  SanJose: 'United States', Santiago: 'Chile', SaoPaulo: 'Brazil', Seoul: 'South Korea',
  Singapore: 'Singapore', Stockholm: 'Sweden', Sydney: 'Australia', Tokyo: 'Japan', Toronto: 'Canada',
  Turin: 'Italy', Valparaiso: 'Chile', Vinhedo: 'Brazil', Zurich: 'Switzerland'
};

function cleanHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function cityFromName(name) {
  const match = String(name).match(/\(([^)]+)\)/);
  if (!match) return String(name).trim();
  return match[1].split(',')[0].trim();
}

function coordinateKey(city) {
  return String(city || '').replace(/[^a-z]/gi, '').toLowerCase();
}

// Both city tables are looked up through coordinateKey so their key styles can differ.
function indexByCity(table) {
  return Object.keys(table).reduce((map, city) => {
    map[coordinateKey(city)] = table[city];
    return map;
  }, {});
}

const normalizedCoordinates = indexByCity(CITY_COORDINATES);
const normalizedCountries = indexByCity(CITY_COUNTRIES);

function parseOracleRegionRows(html, sourceUrl, warn = console.warn) {
  const records = [];
  const rows = String(html).match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  rows.forEach((row) => {
    const cells = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((match) => cleanHtml(match[1]));
    const identifierIndex = cells.findIndex((cell) => /^[a-z]{2,}(?:-[a-z0-9]+)+-\d+$/.test(cell));
    if (identifierIndex < 1) return;
    const regionId = cells[identifierIndex];
    const regionName = cells[identifierIndex - 1];
    const realm = cells.find((cell) => /^OC\d+$/i.test(cell)) || 'OC1';
    const adsCell = cells[cells.length - 1];
    const availabilityDomains = /^\d+$/.test(adsCell) ? Number(adsCell) : 1;
    const locationCell = cells[identifierIndex + 1] && cells[identifierIndex + 1].includes(',') ? cells[identifierIndex + 1] : '';
    const city = locationCell ? locationCell.split(',')[0].trim() : cityFromName(regionName);
    const country = locationCell ? locationCell.split(',').slice(1).join(',').trim() : (normalizedCountries[coordinateKey(city)] || null);
    const coordinates = normalizedCoordinates[coordinateKey(city)];
    if (!coordinates) {
      warn(`Skipping OCI region ${regionId}: no coordinates for city "${city}". Add it to CITY_COORDINATES.`);
      return;
    }
    if (!country) warn(`OCI region ${regionId}: no country known for city "${city}". Add it to CITY_COUNTRIES.`);
    records.push({
      csp: 'OCI', area: realm, region: regionName, code: regionId,
      AZzones: availabilityDomains, Lzones: 0, Wzones: 0, location: city,
      state: country,
      opened: 'Live', status: 'live', source: sourceUrl, lastVerified: new Date().toISOString().slice(0, 10),
      coord: coordinates.join(',')
    });
  });
  return records;
}

async function fetchOracleRegions(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable; using the cached OCI data.');
  // One unavailable page should not discard the pages that did load.
  const results = await Promise.allSettled(ORACLE_REGION_SOURCES.map(async (sourceUrl) => {
    const response = await fetchImpl(sourceUrl, {
      headers: { 'user-agent': 'CloudVendorMap OCI region refresh' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Oracle returned ${response.status} for ${sourceUrl}`);
    return { sourceUrl, html: await response.text() };
  }));
  const pages = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') pages.push(result.value);
    else console.warn(`Skipping ${ORACLE_REGION_SOURCES[index]}: ${result.reason && result.reason.message}`);
  });
  const records = pages.flatMap((page) => parseOracleRegionRows(page.html, page.sourceUrl));
  const unique = new Map(records.map((record) => [record.code, record]));
  if (unique.size < 20) throw new Error(`Oracle region refresh returned only ${unique.size} usable regions.`);
  return Array.from(unique.values());
}

module.exports = { fetchOracleRegions, parseOracleRegionRows };
