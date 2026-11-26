function docReady(fn) {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(fn, 1);
  } else {
    document.addEventListener("DOMContentLoaded", fn);
  }
}

var providerState = { AWS: false, Azure: false, GCP: false, ALI: false, OCI: false, CUSTOMER: false };
var countryHighlighting = false;
var countryCities = false;
var companyApprovedOnly = false;
var availabilityZonesVisible = false;
var markerRadius = 5;

function initializeMap() {
  if (initializeMap.started) return;
  if (!window.CSP_READY || !window.WORLD_READY) {
    window.addEventListener("locations-ready", initializeMap, { once: true });
    window.addEventListener("world-ready", initializeMap, { once: true });
    return;
  }
  initializeMap.started = true;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var mapWidth = 990;
  var mapHeight = 450;
  var mapCenterX = 495;
  var mapCenterY = 225;
  var map = document.querySelector("#map");
  var svg = document.createElementNS(SVG_NS, "svg");
  var tooltip = document.createElement("div");
  var mapView = { x: 0, y: 0, zoom: 0 };
  var zoomLevels = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 15, 20, 25, 30];
  var maxZoom = zoomLevels.length - 1;
  var pinchZoomAccumulator = 0;
  var dragState = null;
  var capitalMarkers = [];
  var countryPaths = [];
  var searchHighlights = [];
  var referenceCities = [
    { name: "New York", coord: "40.7128,-74.0060" },
    { name: "San Francisco", coord: "37.7749,-122.4194" },
    { name: "Seattle", coord: "47.6062,-122.3321" }
  ];
  var providerSets = { ALI: [], AWS: [], Azure: [], GCP: [], OCI: [], CUSTOMER: [] };
  var providerButtonIds = { ALI: "ali", AWS: "aws", Azure: "azure", GCP: "gcp", OCI: "oci", CUSTOMER: "customer" };

  function createSvgElement(name, attributes) {
    var element = document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function(key) { element.setAttribute(key, attributes[key]); });
    return element;
  }

  function zoomScaleAt(level) { return 1 / zoomLevels[level]; }
  function zoomScale() { return zoomScaleAt(mapView.zoom); }
  function viewBoxWidth() { return mapWidth * zoomScale(); }
  function viewBoxHeight() { return mapHeight * zoomScale(); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function applyViewBox() {
    var width = viewBoxWidth();
    var height = viewBoxHeight();
    mapView.x = clamp(mapView.x, 0, mapWidth - width);
    mapView.y = clamp(mapView.y, 0, mapHeight - height);
    svg.setAttribute("viewBox", [mapView.x, mapView.y, width, height].join(" "));
    countryPaths.forEach(function(path) {
      path.setAttribute("stroke-width", (0.35 * zoomScale()).toFixed(4));
    });
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
    var nextScale = zoomScaleAt(nextZoom);
    var nextWidth = mapWidth * nextScale;
    var nextHeight = mapHeight * nextScale;
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
      cx: (lon + 180) / 360 * mapWidth,
      cy: (90 - lat) / 180 * mapHeight
    };
  }

  function locationMessage(record) {
    return [
      providerLabel(record.csp),
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

  function projectGeometry(geometry) {
    if (geometry.type === "Point") {
      var point = parseLatLon(geometry.coordinates.join(","));
      return "M" + point.cx + "," + point.cy;
    }
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return "";
    var polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map(function(polygon) {
      return polygon.map(function(ring) {
        return ring.map(function(coordinate, index) {
          var point = parseLatLon(coordinate[1] + "," + coordinate[0]);
          return (index ? "L" : "M") + point.cx + "," + point.cy;
        }).join("") + "Z";
      }).join("");
    }).join("");
  }

  function addCountryFeature(feature) {
    var country = feature.properties || {};
    var countryName = country.name || country.ADMIN || "Country";
    var path = createSvgElement("path", {
      d: projectGeometry(feature.geometry),
      fill: "#f7f4f1",
      "fill-rule": "evenodd",
      stroke: "#aeb9c8",
      "stroke-opacity": "0.72",
      "stroke-width": "0.35"
    });
    path.dataset.fill = "#f7f4f1";
    path.dataset.hoverFill = "#c5e3c5";
    path.addEventListener("mouseenter", function() {
      if (!countryHighlighting) return;
      path.setAttribute("fill", path.dataset.hoverFill);
      showTooltip(path, countryName, "country");
    });
    path.addEventListener("mouseleave", function() {
      path.setAttribute("fill", path.dataset.fill);
      if (countryHighlighting) hideTooltip();
    });
    countryLayer.appendChild(path);
    countryPaths.push(path);
  }

  function providerColor(provider) {
    return { AWS: "#ffb70e", Azure: "#2563eb", GCP: "#24b824", ALI: "#f59e0b", OCI: "#c74634", CUSTOMER: "#7c3aed" }[provider] || "#2563eb";
  }

  function providerLabel(provider) {
    return { AWS: "Amazon Web Services", Azure: "Microsoft Azure", GCP: "Google Cloud", ALI: "Alibaba Cloud", OCI: "Oracle Cloud", CUSTOMER: (window.CUSTOMER_NAME || "Customer") + " DC's" }[provider] || provider;
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
    var locationMarkers = [];
    (window.CSP || []).forEach(function(record) {
      var point = parseLatLon(record.coord);
      if (!providerSets[record.csp]) return;
      locationMarkers.push({ record: record, point: point, isAvailabilityZone: false });
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
        locationMarkers.push({ record: zoneRecord, point: parseLatLon(zoneCoord), isAvailabilityZone: true });
      });
    });
    var overlapGroups = {};
    locationMarkers.forEach(function(item) {
      var key = item.point.cx.toFixed(3) + "," + item.point.cy.toFixed(3);
      if (!overlapGroups[key]) overlapGroups[key] = [];
      overlapGroups[key].push(item);
    });
    Object.keys(overlapGroups).forEach(function(key) {
      var group = overlapGroups[key];
      group.forEach(function(item, index) {
        var angle = (Math.PI * 2 * index) / group.length;
        // Keep duplicate-location markers close to the real city when zoomed in.
        var spread = group.length > 1 ? 0.3 : 0;
        var point = { cx: item.point.cx + Math.cos(angle) * spread, cy: item.point.cy + Math.sin(angle) * spread };
        var provider = item.record.csp;
        providerSets[provider].push(createLocationMarker(item.record, point, providerColor(provider), item.isAvailabilityZone));
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
    var zoneNames = record.availabilityZone ? [] : (record.availabilityZones || []).reduce(function(names, zone) {
      return names.concat([zone.id, zone.code, zone.name]);
    }, []);
    return [
      record.csp,
      providerLabel(record.csp),
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
    capitalMarkers.forEach(function(marker) {
      marker.element.setAttribute("r", marker.radius * scale);
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
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "World map of cloud provider and customer data-center locations");
  map.appendChild(svg);
  svg.appendChild(background);
  svg.appendChild(countryLayer);
  svg.appendChild(capitalLayer);
  svg.appendChild(markerLayer);
  svg.appendChild(searchHighlightLayer);

  (window.WORLD_GEOJSON.features || []).forEach(addCountryFeature);

  Object.keys(WORLD).forEach(function(countryCode) {
    var country = WORLD[countryCode];
    if (!country.capital) return;
    var capitalPoint = parseLatLon(country.capital[0]);
    var capital = createSvgElement("circle", { cx: capitalPoint.cx, cy: capitalPoint.cy, r: markerRadius, fill: "#6b46c1" });
    capital.style.display = "none";
    capital.addEventListener("mouseenter", function() { showTooltip(capital, country.capital[1], "city"); });
    capital.addEventListener("mouseleave", hideTooltip);
    capitalLayer.appendChild(capital);
    capitalMarkers.push({ element: capital, radius: markerRadius });
  });

  referenceCities.forEach(function(city) {
    var point = parseLatLon(city.coord);
    var marker = createSvgElement("circle", {
      cx: point.cx,
      cy: point.cy,
      r: markerRadius,
      fill: "#6b46c1",
      stroke: "#ffffff",
      "stroke-width": "0.75"
    });
    marker.style.display = "none";
    marker.addEventListener("mouseenter", function() { showTooltip(marker, city.name, "city"); });
    marker.addEventListener("mouseleave", hideTooltip);
    capitalLayer.appendChild(marker);
    capitalMarkers.push({ element: marker, radius: markerRadius });
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
    capitalMarkers.forEach(function(marker) { marker.radius = markerRadius; });
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
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinch gestures arrive as high-frequency, small wheel events.
      // Accumulate them so a pinch needs deliberate movement before advancing
      // one of the discrete zoom levels.
      pinchZoomAccumulator += event.deltaY;
      if (Math.abs(pinchZoomAccumulator) < 40) {
        event.preventDefault();
        return;
      }
      var pinchDirection = pinchZoomAccumulator > 0 ? -1 : 1;
      pinchZoomAccumulator = 0;
      zoomAt(pinchDirection, localPoint(event));
    } else {
      zoomAt(event.deltaY > 0 ? -1 : 1, localPoint(event));
    }
    event.preventDefault();
  }, { passive: false });
  if (window.ResizeObserver) new ResizeObserver(hideTooltip).observe(map);
}

docReady(initializeMap);
