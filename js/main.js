function docReady(fn) {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(fn, 1);
  } else {
    document.addEventListener("DOMContentLoaded", fn);
  }
}

var providerState = { AWS: false, Azure: false, GCP: false, ALI: false, OCI: false };
var countryHighlighting = false;
var countryCities = false;
var companyApprovedOnly = false;
var availabilityZonesVisible = false;
var markerRadius = 5;

function initializeMap() {
  if (initializeMap.started) return;
  if (!window.CSP_READY) {
    window.addEventListener("locations-ready", initializeMap, { once: true });
    return;
  }
  initializeMap.started = true;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var mapWidth = 990;
  var mapHeight = 450;
  var horizontalScale = 0.88;
  var mapCenterX = 495;
  var mapCenterY = 225;
  var mapVerticalOffset = 0;
  var map = document.querySelector("#map");
  var svg = document.createElementNS(SVG_NS, "svg");
  var tooltip = document.createElement("div");
  var mapView = { x: 0, y: 0, zoom: 0 };
  var zoomStep = 0.1;
  var maxZoom = 9;
  var dragState = null;
  var capitalMarkers = [];
  var searchHighlights = [];
  var referenceCities = [
    { name: "New York", coord: "40.7128,-74.0060" },
    { name: "San Francisco", coord: "37.7749,-122.4194" },
    { name: "Seattle", coord: "47.6062,-122.3321" }
  ];
  var providerSets = { ALI: [], AWS: [], Azure: [], GCP: [], OCI: [] };
  var providerButtonIds = { ALI: "ali", AWS: "aws", Azure: "azure", GCP: "gcp", OCI: "oci" };

  function createSvgElement(name, attributes) {
    var element = document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function(key) { element.setAttribute(key, attributes[key]); });
    return element;
  }

  function zoomScale() { return Math.max(0.01, 1 - mapView.zoom * zoomStep); }
  function viewBoxWidth() { return mapWidth * zoomScale(); }
  function viewBoxHeight() { return mapHeight * zoomScale(); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function applyViewBox() {
    var width = viewBoxWidth();
    var height = viewBoxHeight();
    mapView.x = clamp(mapView.x, 0, mapWidth - width);
    mapView.y = clamp(mapView.y, 0, mapHeight - height);
    svg.setAttribute("viewBox", [mapView.x, mapView.y, width, height].join(" "));
    applyMarkerScale();
  }

  function localPoint(event) {
    var rect = map.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect: rect };
  }

  function zoomAt(delta, point) {
    var previousWidth = viewBoxWidth();
    var previousHeight = viewBoxHeight();
    var nextZoom = clamp(mapView.zoom + delta, 0, maxZoom);
    if (nextZoom === mapView.zoom) return;
    var nextWidth = mapWidth * (1 - nextZoom * zoomStep);
    var nextHeight = mapHeight * (1 - nextZoom * zoomStep);
    var ratioX = point.x / point.rect.width;
    var ratioY = point.y / point.rect.height;
    var anchorX = mapView.x + ratioX * previousWidth;
    var anchorY = mapView.y + ratioY * previousHeight;
    mapView.zoom = nextZoom;
    mapView.x = anchorX - ratioX * nextWidth;
    mapView.y = anchorY - ratioY * nextHeight;
    applyViewBox();
    hideTooltip();
  }

  function showTooltip(element, message, type) {
    if (!message) return;
    var mapRect = map.getBoundingClientRect();
    var elementRect = element.getBoundingClientRect();
    var x = elementRect.left - mapRect.left + elementRect.width / 2;
    var y = elementRect.top - mapRect.top;
    tooltip.replaceChildren();
    var lines = message.split("\n");
    if (type && lines.length) {
      var heading = document.createElement("div");
      var icon = document.createElement("span");
      icon.className = "tooltip-icon tooltip-icon-" + type;
      icon.setAttribute("aria-hidden", "true");
      heading.className = "tooltip-heading";
      heading.appendChild(icon);
      heading.appendChild(document.createTextNode(lines.shift()));
      tooltip.appendChild(heading);
    }
    lines.forEach(function(line, index) {
      if (index) tooltip.appendChild(document.createElement("br"));
      tooltip.appendChild(document.createTextNode(line));
    });
    tooltip.style.display = "block";
    tooltip.style.left = Math.max(8, Math.min(x + 12, mapRect.width - tooltip.offsetWidth - 8)) + "px";
    tooltip.style.top = Math.max(8, y - tooltip.offsetHeight - 10) + "px";
  }

  function hideTooltip() { tooltip.style.display = "none"; }

  function parseLatLon(latlon) {
    var values = String(latlon || "").split(",");
    var lat = Number(values[0]);
    var lon = Number(values[1]);
    return {
      cx: mapCenterX + (lon * 2.6938 + 465.4 - mapCenterX) * horizontalScale,
      cy: lat * -2.6938 + 227.066 + mapVerticalOffset
    };
  }

  function locationMessage(record) {
    return [
      record.csp,
      record.availabilityZone ? "Availability zone: " + record.availabilityZone : null,
      record.location || record.region,
      record.region ? "Region: " + record.region : null,
      record.state ? "Country: " + record.state : null,
      record.code && record.code !== "TBD" ? "ID: " + record.code : null,
      record.status || record.opened ? "Status: " + (record.status || record.opened) : null,
      record.dataCenterAddress ? "Address: " + record.dataCenterAddress : null,
      record.companyAccessStatus ? "Company access: " + record.companyAccessStatus : null
    ].filter(function(line) { return line; }).join("\n");
  }

  function addCountry(countryCode) {
    var country = WORLD[countryCode];
    var path = createSvgElement("path", {
      d: country.path,
      fill: "#f7f4f1",
      stroke: "#aeb9c8",
      "stroke-opacity": "0.72",
      "stroke-width": "0.35"
    });
    path.dataset.fill = "#f7f4f1";
    path.dataset.hoverFill = "#b8d7e9";
    path.addEventListener("mouseenter", function() {
      if (!countryHighlighting) return;
      path.setAttribute("fill", path.dataset.hoverFill);
      showTooltip(path, country.name, "country");
    });
    path.addEventListener("mouseleave", function() {
      path.setAttribute("fill", path.dataset.fill);
      if (countryHighlighting) hideTooltip();
    });
    countryLayer.appendChild(path);

    if (country.capital) {
      var capitalPoint = parseLatLon(country.capital[0]);
      var capital = createSvgElement("circle", { cx: capitalPoint.cx, cy: capitalPoint.cy, r: 2, fill: "#6b46c1" });
      capital.style.display = "none";
      capital.addEventListener("mouseenter", function() { showTooltip(capital, country.capital[1], "city"); });
      capital.addEventListener("mouseleave", hideTooltip);
      capitalLayer.appendChild(capital);
      capitalMarkers.push({ element: capital, radius: 2 });
    }
  }

  function providerColor(provider) {
    return { AWS: "#ffb70e", Azure: "#2563eb", GCP: "#24b824", ALI: "#f59e0b", OCI: "#c74634" }[provider] || "#2563eb";
  }

  function createLocationMarker(record, point, color, isAvailabilityZone) {
    var marker = createSvgElement("circle", {
      cx: point.cx,
      cy: point.cy,
      r: markerRadius,
      fill: color,
      stroke: isAvailabilityZone ? "#ffffff" : "none",
      "stroke-width": isAvailabilityZone ? "1" : "0"
    });
    marker.style.display = "none";
    marker.addEventListener("mouseenter", function() { showTooltip(marker, locationMessage(record)); });
    marker.addEventListener("mouseleave", hideTooltip);
    markerLayer.appendChild(marker);
    return { element: marker, record: record, radius: markerRadius, isAvailabilityZone: isAvailabilityZone };
  }

  function addLocationRecords() {
    (window.CSP || []).forEach(function(record) {
      var point = parseLatLon(record.coord);
      if (record.csp === "AWS") point.cy -= 1;
      if (record.csp === "Azure" || record.csp === "ALI") point.cx -= 1;
      if (record.csp === "GCP" || record.csp === "OCI") point.cx += 1;
      if (!providerSets[record.csp]) return;
      providerSets[record.csp].push(createLocationMarker(record, point, providerColor(record.csp), false));
      (record.availabilityZones || []).forEach(function(zone) {
        var coordinates = zone.coordinates || {};
        var zoneCoord = zone.coord || (Number.isFinite(Number(coordinates.lat)) && Number.isFinite(Number(coordinates.lon))
          ? coordinates.lat + "," + coordinates.lon : null);
        if (!zoneCoord) return;
        var zoneRecord = Object.assign({}, record, zone, {
          csp: record.csp,
          region: record.region,
          code: zone.id || zone.code || record.code,
          location: zone.location || zone.name || record.location,
          coord: zoneCoord,
          availabilityZone: zone.name || zone.id || zone.code || ""
        });
        providerSets[record.csp].push(createLocationMarker(zoneRecord, parseLatLon(zoneCoord), providerColor(record.csp), true));
      });
    });
  }

  function markerIsAllowed(marker) {
    return (!marker.isAvailabilityZone || availabilityZonesVisible) &&
      (!companyApprovedOnly || (marker.record && marker.record.companyAccessStatus === "enabled"));
  }

  function updateProviderMarkers(provider, active) {
    providerSets[provider].forEach(function(marker) {
      marker.element.style.display = active && markerIsAllowed(marker) ? "" : "none";
    });
  }

  function bringProviderToFront(provider) {
    providerSets[provider].forEach(function(marker) { markerLayer.appendChild(marker.element); });
  }

  function clearLocationSearch() {
    searchHighlightLayer.replaceChildren();
    searchHighlights = [];
    updateAllProviders();
    applyMarkerScale();
  }

  function locationSearchText(record) {
    var providerNames = {
      AWS: "Amazon Web Services",
      Azure: "Microsoft Azure",
      GCP: "Google Cloud",
      ALI: "Alibaba Cloud",
      OCI: "Oracle Cloud"
    };
    var zoneNames = record.availabilityZone ? [] : (record.availabilityZones || []).reduce(function(names, zone) {
      return names.concat([zone.id, zone.code, zone.name]);
    }, []);
    return [
      record.csp,
      providerNames[record.csp],
      record.region,
      record.code,
      record.location,
      record.state,
      record.availabilityZone
    ].concat(zoneNames).filter(Boolean).map(function(value) { return String(value).toLowerCase(); });
  }

  function highlightLocationSearch(query) {
    var result = document.querySelector("#locationSearchResult");
    var normalizedQuery = String(query || "").trim().toLowerCase();
    clearLocationSearch();
    if (!normalizedQuery) {
      if (result) result.textContent = "";
      return;
    }
    var matches = Object.keys(providerSets).reduce(function(all, provider) {
      return all.concat(providerSets[provider].filter(function(marker) {
        return locationSearchText(marker.record).some(function(value) {
          return value.indexOf(normalizedQuery) === 0;
        });
      }));
    }, []);
    matches.forEach(function(marker) {
      marker.element.style.display = "";
      markerLayer.appendChild(marker.element);
      var highlight = createSvgElement("circle", {
        cx: marker.element.getAttribute("cx"),
        cy: marker.element.getAttribute("cy"),
        r: marker.radius * 2.8,
        fill: "none",
        stroke: providerColor(marker.record.csp),
        "stroke-width": "1.5"
      });
      highlight.classList.add("location-search-highlight");
      searchHighlightLayer.appendChild(highlight);
      searchHighlights.push({ element: highlight, radius: marker.radius * 2.8 });
    });
    applyMarkerScale();
    if (result) result.textContent = matches.length ? matches.length + " location" + (matches.length === 1 ? "" : "s") + " highlighted" : "No matching region or AZ found";
  }

  function applyMarkerScale() {
    var scale = zoomScale();
    Object.keys(providerSets).forEach(function(provider) {
      providerSets[provider].forEach(function(marker) {
        marker.element.setAttribute("r", marker.radius * scale);
      });
    });
    searchHighlights.forEach(function(highlight) {
      highlight.element.setAttribute("r", highlight.radius * scale);
    });
  }

  function setFeatureAvailability() {
    Object.keys(providerButtonIds).forEach(function(provider) {
      var button = document.querySelector("#" + providerButtonIds[provider]);
      var available = providerSets[provider].length > 0;
      button.disabled = !available;
      button.setAttribute("aria-disabled", available ? "false" : "true");
      if (!available) button.title = "No locations in the current data";
    });
    var allMarkers = Object.keys(providerSets).reduce(function(all, provider) { return all.concat(providerSets[provider]); }, []);
    [
      { id: "companyApprovedOnly", available: allMarkers.some(function(marker) { return marker.record && marker.record.companyAccessStatus === "enabled"; }) },
      { id: "availabilityZones", available: allMarkers.some(function(marker) { return marker.isAvailabilityZone; }) }
    ].forEach(function(feature) {
      var input = document.querySelector("#" + feature.id);
      var row = input.closest(".switch-row");
      input.disabled = !feature.available;
      row.classList.toggle("is-disabled", !feature.available);
      if (!feature.available) row.title = "No matching data in the current dataset";
    });
  }

  function updateAllProviders() {
    Object.keys(providerSets).forEach(function(provider) { updateProviderMarkers(provider, providerState[provider]); });
  }

  function beginDrag(event) {
    if (event.target.closest && event.target.closest("#mapControls, #mapButtons")) return;
    var point = localPoint(event);
    dragState = {
      id: typeof event.pointerId === "number" ? event.pointerId : "mouse",
      clientX: event.clientX,
      clientY: event.clientY,
      x: mapView.x,
      y: mapView.y,
      width: viewBoxWidth(),
      height: viewBoxHeight(),
      rect: point.rect
    };
    map.classList.add("grabbing");
    if (map.setPointerCapture && typeof event.pointerId === "number") map.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragState || (typeof event.pointerId === "number" && event.pointerId !== dragState.id)) return;
    mapView.x = dragState.x - (event.clientX - dragState.clientX) * dragState.width / dragState.rect.width;
    mapView.y = dragState.y - (event.clientY - dragState.clientY) * dragState.height / dragState.rect.height;
    applyViewBox();
    hideTooltip();
    event.preventDefault();
  }

  function endDrag(event) {
    if (!dragState || (typeof event.pointerId === "number" && event.pointerId !== dragState.id)) return;
    dragState = null;
    map.classList.remove("grabbing");
  }

  var background = createSvgElement("rect", { x: 0, y: 0, width: mapWidth, height: mapHeight, fill: "#dcecf4" });
  var countryLayer = createSvgElement("g", { "aria-label": "World map" });
  var capitalLayer = createSvgElement("g", { "aria-label": "Country capitals" });
  var markerLayer = createSvgElement("g", { "aria-label": "Cloud provider locations" });
  var searchHighlightLayer = createSvgElement("g", { "aria-label": "Search highlights" });
  svg.setAttribute("viewBox", "0 0 " + mapWidth + " " + mapHeight);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "World map of cloud provider locations");
  map.appendChild(svg);
  svg.appendChild(background);
  svg.appendChild(countryLayer);
  svg.appendChild(capitalLayer);
  svg.appendChild(markerLayer);
  svg.appendChild(searchHighlightLayer);

  Object.keys(WORLD).forEach(addCountry);
  var minY = Infinity;
  var maxY = -Infinity;
  Array.prototype.forEach.call(countryLayer.children, function(path) {
    var bounds = path.getBBox();
    minY = Math.min(minY, bounds.y);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });
  if (Number.isFinite(minY) && Number.isFinite(maxY)) {
    mapVerticalOffset = (mapHeight - (maxY - minY)) / 2 - minY;
    countryLayer.setAttribute("transform", "translate(0 " + mapVerticalOffset + ") translate(" + mapCenterX + " " + mapCenterY + ") scale(" + horizontalScale + " 1) translate(" + (-mapCenterX) + " " + (-mapCenterY) + ")");
    capitalMarkers.forEach(function(marker) {
      marker.element.setAttribute("cy", Number(marker.element.getAttribute("cy")) + mapVerticalOffset);
    });
  }

  referenceCities.forEach(function(city) {
    var point = parseLatLon(city.coord);
    var marker = createSvgElement("circle", {
      cx: point.cx,
      cy: point.cy,
      r: 2.5,
      fill: "#6b46c1",
      stroke: "#ffffff",
      "stroke-width": "0.75"
    });
    marker.style.display = "none";
    marker.addEventListener("mouseenter", function() { showTooltip(marker, city.name, "city"); });
    marker.addEventListener("mouseleave", hideTooltip);
    capitalLayer.appendChild(marker);
    capitalMarkers.push({ element: marker, radius: 2.5 });
  });

  addLocationRecords();
  tooltip.className = "location-tooltip";
  tooltip.style.display = "none";
  map.appendChild(tooltip);
  setFeatureAvailability();
  applyViewBox();

  document.querySelector("#countryHighlighting").addEventListener("change", function(event) {
    countryHighlighting = event.target.checked;
    if (!countryHighlighting) hideTooltip();
  });
  document.querySelector("#countryCities").addEventListener("change", function(event) {
    countryCities = event.target.checked;
    capitalMarkers.forEach(function(marker) { marker.element.style.display = countryCities ? "" : "none"; });
  });
  document.querySelector("#companyApprovedOnly").addEventListener("change", function(event) {
    companyApprovedOnly = event.target.checked;
    updateAllProviders();
  });
  document.querySelector("#availabilityZones").addEventListener("change", function(event) {
    availabilityZonesVisible = event.target.checked;
    updateAllProviders();
  });
  document.querySelector("#dcMarkerSize").addEventListener("input", function(event) {
    markerRadius = Number(event.target.value);
    document.querySelector("#dcSizeValue").value = markerRadius + " px";
    event.target.style.setProperty("--range-progress", ((markerRadius - Number(event.target.min)) / (Number(event.target.max) - Number(event.target.min)) * 100) + "%");
    Object.keys(providerSets).forEach(function(provider) {
      providerSets[provider].forEach(function(marker) { marker.radius = markerRadius; });
    });
    applyMarkerScale();
  });

  var locationSearch = document.querySelector("#locationSearch");
  var locationSearchButton = document.querySelector("#locationSearchButton");
  if (locationSearch && locationSearchButton) {
    locationSearchButton.addEventListener("click", function() { highlightLocationSearch(locationSearch.value); });
    locationSearch.addEventListener("keydown", function(event) {
      if (event.key === "Enter") highlightLocationSearch(locationSearch.value);
    });
    locationSearch.addEventListener("search", function() {
      if (!locationSearch.value) highlightLocationSearch("");
    });
    locationSearch.addEventListener("input", function() {
      if (!locationSearch.value) highlightLocationSearch("");
    });
  }

  Object.keys(providerSets).forEach(function(provider) {
    var button = document.querySelector("#" + providerButtonIds[provider]);
    button.addEventListener("click", function() {
      providerState[provider] = !providerState[provider];
      button.classList.toggle("pressed", providerState[provider]);
      button.setAttribute("aria-pressed", String(providerState[provider]));
      updateProviderMarkers(provider, providerState[provider]);
      if (providerState[provider]) bringProviderToFront(provider);
    });
  });

  document.querySelector("#plus").addEventListener("click", function() {
    var rect = map.getBoundingClientRect();
    zoomAt(1, { x: rect.width / 2, y: rect.height / 2, rect: rect });
  });
  document.querySelector("#minus").addEventListener("click", function() {
    var rect = map.getBoundingClientRect();
    zoomAt(-1, { x: rect.width / 2, y: rect.height / 2, rect: rect });
  });
  document.querySelector("#home").addEventListener("click", function() {
    mapView = { x: 0, y: 0, zoom: 0 };
    applyViewBox();
    hideTooltip();
  });

  if (window.PointerEvent) {
    map.addEventListener("pointerdown", beginDrag);
    map.addEventListener("pointermove", moveDrag, { passive: false });
    map.addEventListener("pointerup", endDrag);
    map.addEventListener("pointercancel", endDrag);
  } else {
    map.addEventListener("mousedown", beginDrag);
    document.addEventListener("mousemove", moveDrag, false);
    document.addEventListener("mouseup", endDrag, false);
  }
  map.addEventListener("wheel", function(event) {
    if (event.target.closest && event.target.closest("#mapControls")) return;
    zoomAt(event.deltaY > 0 ? -1 : 1, localPoint(event));
    event.preventDefault();
  }, { passive: false });
  if (window.ResizeObserver) new ResizeObserver(hideTooltip).observe(map);
}

docReady(initializeMap);
