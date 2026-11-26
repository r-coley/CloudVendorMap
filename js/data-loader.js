window.CSP_READY = false;
window.CUSTOMER_NAME = 'Customer';

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
  var customerButtonLabel = document.querySelector('#customerButtonLabel');
  if (customerButtonLabel) customerButtonLabel.textContent = window.CUSTOMER_NAME + " DC's";
  window.dispatchEvent(new Event('locations-ready'));
}

function locationKey(record) {
  var provider = String(record.provider || record.csp || '').trim().toUpperCase();
  var regionId = String(record.regionId || record.code || '').trim();
  return provider + ':' + regionId;
}

function mergeRuntimeCustomerLocations(records) {
  var storedCustomer = loadStoredCustomerLocations();
  var customerSource = storedCustomer ? Promise.resolve(storedCustomer) : fetch('./data/locations.customer.json?refresh=' + Date.now(), { cache: 'no-store' })
    .then(function(response) {
      if (response.status === 404) return [];
      if (!response.ok) throw new Error('Could not load local customer locations');
      return response.json();
    });
  return customerSource
    .then(function(payload) {
      var customerRecords = payload;
      if (!Array.isArray(payload)) {
        window.CUSTOMER_NAME = String(payload.customerName || 'Customer').trim() || 'Customer';
        customerRecords = payload.locations;
      }
      if (!Array.isArray(customerRecords)) throw new Error('Local customer locations must be a JSON array');
      var merged = records.slice();
      var indexes = {};
      merged.forEach(function(record, index) { indexes[locationKey(record)] = index; });
      customerRecords.forEach(function(record) {
        var key = locationKey(record);
        if (!key || key === ':') return;
        if (Object.prototype.hasOwnProperty.call(indexes, key)) merged[indexes[key]] = record;
        else {
          indexes[key] = merged.length;
          merged.push(record);
        }
      });
      return merged;
    })
    .catch(function(error) {
      console.warn('Ignoring local customer locations:', error.message);
      return records;
    });
}

function loadStoredJson(key) {
  try {
    var stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Ignoring invalid stored location data:', error.message);
    return null;
  }
}

function loadStoredCustomerLocations() {
  return loadStoredJson('cloudVendorCustomerOverride');
}

var storedLocations = loadStoredJson('cloudVendorLocationsOverride');
if (Array.isArray(storedLocations)) {
  finishLocationLoad(storedLocations);
}

if (!window.CSP_READY) fetch('./data/locations.generated.json?refresh=' + Date.now(), { cache: 'no-store' })
  .then(function(response) {
    if (!response.ok) throw new Error('Could not load location data');
    return response.json();
  })
  .then(mergeRuntimeCustomerLocations)
  .then(finishLocationLoad)
  .catch(function(error) {
    console.error('Location data could not be loaded:', error.message);
    finishLocationLoad([]);
  });

function setupLocationControls() {
  if (document.documentElement.getAttribute('data-location-controls-ready') === 'true') return;
  document.documentElement.setAttribute('data-location-controls-ready', 'true');
  var upload = document.querySelector('#locationDataUpload');
  var download = document.querySelector('#downloadLocationData');
  var dataScope = document.querySelector('#dataScope');
  var customerScope = false;
  function updateDataScope() {
    customerScope = dataScope && dataScope.value === '0';
    var scopeLabel = customerScope ? 'customer' : 'cloud';
    if (dataScope) {
      dataScope.setAttribute('aria-label', 'JSON data scope: ' + (customerScope ? 'Customer' : 'Cloud'));
      dataScope.style.setProperty('--scope-color', '#111827');
      dataScope.style.setProperty('--scope-shadow', 'rgba(15, 23, 42, .35)');
    }
    if (upload) upload.title = 'Upload a JSON file for the selected ' + scopeLabel + ' data scope';
    if (download) download.title = 'Download ' + scopeLabel + ' location data as JSON';
  }
  if (dataScope) {
    dataScope.addEventListener('input', updateDataScope);
    updateDataScope();
  }
  function downloadJson(text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = customerScope ? 'locations.customer.json' : 'locations.generated.json';
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
        var payload = JSON.parse(reader.result);
        var records = customerScope && !Array.isArray(payload) ? payload.locations : payload;
        if (customerScope && !Array.isArray(payload)) {
          payload.customerName = String(payload.customerName || 'Customer').trim() || 'Customer';
        }
        if (!Array.isArray(records) || (!customerScope && !records.length)) throw new Error('The JSON must contain a ' + (customerScope ? '' : 'non-empty ') + 'array of locations.');
        var valid = records.every(function(record) {
          return (record.provider || record.csp) && (record.regionId || record.code) && (record.coordinates || record.coord);
        });
        if (!valid) throw new Error('Each location needs provider, regionId, and coordinates fields.');
        if (customerScope && Array.isArray(payload)) payload = { customerName: window.CUSTOMER_NAME || 'Customer', locations: payload };
        fetch(customerScope ? '/api/save-locations/customer' : '/api/save-locations/cloud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function(response) {
          return response.json().then(function(result) {
            if (!response.ok) throw new Error(result.error || 'Could not save location data');
            return result;
          });
        }).then(function() {
          window.localStorage.removeItem(customerScope ? 'cloudVendorCustomerOverride' : 'cloudVendorLocationsOverride');
          window.location.reload();
        }).catch(function(error) {
          window.alert('Location JSON could not be saved: ' + error.message);
          upload.value = '';
        });
      } catch (error) {
        window.alert('Location JSON could not be loaded: ' + error.message);
        upload.value = '';
      }
    };
    reader.readAsText(file);
  });
  if (download) download.addEventListener('click', function() {
    download.disabled = true;
    if (customerScope) {
      var storedCustomer = loadStoredCustomerLocations();
      var customerFetch = storedCustomer ? Promise.resolve(storedCustomer) : fetch('./data/locations.customer.json')
        .then(function(response) {
          if (response.status === 404) return { customerName: window.CUSTOMER_NAME || 'Customer', locations: [] };
          if (!response.ok) throw new Error('customer data unavailable');
          return response.json();
        });
      customerFetch.then(function(payload) {
        downloadJson(JSON.stringify(payload, null, 2) + '\n');
      }).catch(function(error) {
        console.error('Could not download customer location data:', error.message);
      }).finally(function() {
        download.disabled = false;
      });
      return;
    }
    fetch('./data/locations.generated.json?download=' + Date.now(), { cache: 'no-store' })
      .then(function(response) {
        if (!response.ok) throw new Error('generated data unavailable');
        return response.text();
      })
      .then(function(text) {
        downloadJson(text);
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
