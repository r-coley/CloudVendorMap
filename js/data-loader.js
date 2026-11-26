window.CSP_READY = false;

function toLegacyRecords(records) {
  return records.map(function(record) {
    var coordinates = record.coordinates || {};
    var provider = record.provider || record.csp;
    var normalizedProvider = String(provider || '').trim().toUpperCase().replace(/[’']/g, '').replace(/[\s_-]+/g, '');
    if (normalizedProvider === 'CUSTOMERDC' || normalizedProvider === 'CUSTOMERDCS') provider = 'CUSTOMER';
    var regionId = record.regionId || record.code;
    var regionName = record.regionName || record.region;
    var location = record.location || regionName;
    var country = record.country || record.state || '';
    var coord = record.coord || (coordinates.lat + ',' + coordinates.lon);
    return {
      csp: provider,
      area: country,
      region: regionName,
      code: regionId,
      AZzones: record.zones || record.AZzones || record.Azones || 0,
      Lzones: 0,
      Wzones: 0,
      location: location,
      state: country,
      opened: record.status || record.opened || 'unknown',
      status: record.status,
      source: record.sourceUrl || record.source,
      lastVerified: record.lastVerified,
      deploymentType: record.deploymentType,
      availabilityZones: record.availabilityZones || record.azLocations || [],
      dataCenterAddress: record.dataCenterAddress,
      companyAccessStatus: record.companyAccessStatus,
      coord: coord
    };
  });
}

function finishLocationLoad(records) {
  window.CSP = toLegacyRecords(records);
  window.CSP_READY = true;
  window.dispatchEvent(new Event('locations-ready'));
}

function loadStoredLocations() {
  try {
    var stored = window.localStorage.getItem('cloudVendorLocationsOverride');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Ignoring invalid stored location data:', error.message);
    return null;
  }
}

var storedLocations = loadStoredLocations();
if (Array.isArray(storedLocations)) {
  finishLocationLoad(storedLocations);
}

if (!window.CSP_READY) fetch('./data/provider-locations.generated.json?refresh=' + Date.now(), { cache: 'no-store' })
  .then(function(response) {
    if (!response.ok) throw new Error('Could not load location data');
    return response.json();
  })
  .then(finishLocationLoad)
  .catch(function(error) {
    // js/csp.js remains available as a local fallback for offline/file previews.
    console.warn('Using fallback location data:', error.message);
    window.CSP_READY = true;
    window.dispatchEvent(new Event('locations-ready'));
  });

function setupLocationControls() {
  if (document.documentElement.getAttribute('data-location-controls-ready') === 'true') return;
  document.documentElement.setAttribute('data-location-controls-ready', 'true');
  var upload = document.querySelector('#locationDataUpload');
  var download = document.querySelector('#downloadLocationData');
  function downloadJson(text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'provider-locations.merged.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }
  if (upload) upload.addEventListener('change', function(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() {
      try {
        var records = JSON.parse(reader.result);
        if (!Array.isArray(records) || !records.length) throw new Error('The JSON must contain a non-empty array of locations.');
        var valid = records.every(function(record) {
          return (record.provider || record.csp) && (record.regionId || record.code) && (record.coordinates || record.coord);
        });
        if (!valid) throw new Error('Each location needs provider, regionId, and coordinates fields.');
        window.localStorage.setItem('cloudVendorLocationsOverride', JSON.stringify(records));
        window.location.reload();
      } catch (error) {
        window.alert('Location JSON could not be loaded: ' + error.message);
        upload.value = '';
      }
    };
    reader.readAsText(file);
  });
  if (download) download.addEventListener('click', function() {
    download.disabled = true;
    fetch('/api/refresh-locations', { method: 'POST' })
      .then(function(response) {
        if (!response.ok) throw new Error('refresh endpoint unavailable');
        return response.json();
      })
      .then(function(payload) {
        downloadJson(JSON.stringify(payload.records, null, 2) + '\n');
      })
      .catch(function() {
        return fetch('./data/provider-locations.generated.json')
          .then(function(response) {
            if (!response.ok) throw new Error('generated data unavailable');
            return response.text();
          })
          .then(function(text) {
            downloadJson(text);
          });
      })
      .catch(function(error) {
        console.error('Could not download location data:', error.message);
      })
      .finally(function() {
        download.disabled = false;
      });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupLocationControls);
} else {
  setupLocationControls();
}
