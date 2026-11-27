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

function setupThemeControl() {
  var themeMode = document.querySelector("#themeMode");
  if (!themeMode) return;
  var savedTheme = window.localStorage.getItem("cloudVendorTheme");
  var dark = savedTheme === "dark";
  themeMode.checked = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeMode.setAttribute("aria-label", "Color theme: " + (dark ? "Dark" : "Light"));
  themeMode.addEventListener("input", function() {
    var nextDark = themeMode.checked;
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    themeMode.setAttribute("aria-label", "Color theme: " + (nextDark ? "Dark" : "Light"));
    window.localStorage.setItem("cloudVendorTheme", nextDark ? "dark" : "light");
    window.dispatchEvent(new Event("theme-changed"));
  });
}

function initializeMap() {
  if (initializeMap.started) return;
  if (!window.WORLD_READY) {
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
  var calloutMode = null;
  var calloutPositions = {};
  var calloutSizes = {};
  var calloutDrag = null;
  var calloutResize = null;
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

  function updateMapTheme() {
    var dark = document.documentElement.dataset.theme === "dark";
    background.setAttribute("fill", dark ? "#0f172a" : "#dcecf4");
    countryPaths.forEach(function(path) {
      path.dataset.fill = dark ? "#1f2937" : "#f7f4f1";
      path.dataset.calloutFill = "";
      path.dataset.hoverFill = dark ? "#355c4d" : "#c5e3c5";
      if (!path.matches(":hover")) path.setAttribute("fill", path.dataset.fill);
      path.setAttribute("stroke", dark ? "#64748b" : "#7f8ea3");
    });
    if (calloutMode) applyCalloutRegionHighlight();
    Object.keys(providerSets).forEach(function(provider) {
      providerSets[provider].forEach(function(marker) {
        marker.element.setAttribute("stroke", providerColor(marker.record.csp));
        marker.element.setAttribute("fill", markerFillColor(marker.record.csp));
        marker.element.setAttribute("stroke-width", markerStrokeWidth(marker));
      });
    });
    if (calloutMode) renderCallouts();
  }

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
  function markerAspectCorrection() {
    var rect = map.getBoundingClientRect();
    return (rect.width / viewBoxWidth()) / (rect.height / viewBoxHeight());
  }
  function compensateMarkerAspect(element, correction) {
    var cx = Number(element.getAttribute("cx"));
    var cy = Number(element.getAttribute("cy"));
    element.setAttribute("transform", "translate(" + cx + " " + cy + ") scale(1 " + correction + ") translate(" + (-cx) + " " + (-cy) + ")");
  }
  function wrapWorldX(value) {
    var wrapped = value % mapWidth;
    return wrapped < -mapWidth / 2 ? wrapped + mapWidth : wrapped > mapWidth / 2 ? wrapped - mapWidth : wrapped;
  }

  function applyViewBox(rescaleMarkers) {
    var width = viewBoxWidth();
    var height = viewBoxHeight();
    // Keep one full world copy available on either side so panning can cross
    // the antimeridian without exposing an empty map area.
    mapView.x = wrapWorldX(mapView.x);
    mapView.y = clamp(mapView.y, 0, mapHeight - height);
    svg.setAttribute("viewBox", [mapView.x, mapView.y, width, height].join(" "));
    countryPaths.forEach(function(path) {
      path.setAttribute("stroke-width", (0.35 * zoomScale()).toFixed(4));
    });
    if (rescaleMarkers) applyMarkerScale();
  }

  function localPoint(event) {
    var rect = map.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect: rect };
  }

  function zoomAt(delta, point) {
    if (calloutMode) return;
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
    applyViewBox(true);
    hideTooltip();
  }

  function showTooltip(element, message, type, event) {
    if (!message) return;
    var mapRect = map.getBoundingClientRect();
    var elementRect = element.getBoundingClientRect();
    var x = event && Number.isFinite(event.clientX)
      ? event.clientX - mapRect.left
      : elementRect.left - mapRect.left + elementRect.width / 2;
    var y = event && Number.isFinite(event.clientY)
      ? event.clientY - mapRect.top
      : elementRect.top - mapRect.top;
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
      stroke: "#7f8ea3",
      "stroke-opacity": "0.78",
      "stroke-width": "0.35"
    });
    path.dataset.fill = "#f7f4f1";
    path.dataset.calloutFill = "";
    path.dataset.hoverFill = "#c5e3c5";
    var center = geometryCenter(feature.geometry);
    path.dataset.calloutRegion = calloutRegionFromCoordinates(center.lat, center.lon, countryName);
    path.addEventListener("mouseenter", function() {
      if (!countryHighlighting) return;
      path.setAttribute("fill", path.dataset.hoverFill);
      showTooltip(path, countryName, "country", event);
    });
    path.addEventListener("mouseleave", function() {
      path.setAttribute("fill", path.dataset.calloutFill || path.dataset.fill);
      if (countryHighlighting) hideTooltip();
    });
    countryLayer.appendChild(path);
    countryPaths.push(path);
  }

  function providerColor(provider) {
    return { AWS: "#ffb70e", Azure: "#2563eb", GCP: "#24b824", ALI: "#f97316", OCI: "#c74634", CUSTOMER: "#7c3aed" }[provider] || "#2563eb";
  }

  function geometryCenter(geometry) {
    var points = [];
    function collect(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        points.push({ lon: Number(value[0]), lat: Number(value[1]) });
        return;
      }
      value.forEach(collect);
    }
    collect(geometry.coordinates);
    if (!points.length) return { lat: 0, lon: 0 };
    return points.reduce(function(center, point) {
      center.lat += point.lat / points.length;
      center.lon += point.lon / points.length;
      return center;
    }, { lat: 0, lon: 0 });
  }

  function markerFillColor(provider) {
    if (document.documentElement.dataset.theme === "dark") return "#f8fafc";
    return { AWS: "#fff7ed", Azure: "#dbeafe", GCP: "#dcfce7", ALI: "#fff7ed", OCI: "#fff5f2", CUSTOMER: "#f5f3ff" }[provider] || "#ffffff";
  }

  function markerStrokeWidth(marker) {
    return ((marker.isAvailabilityZone ? 2.25 : 2) * zoomScale()).toFixed(4);
  }

  function providerLabel(provider) {
    return { AWS: "Amazon Web Services", Azure: "Microsoft Azure", GCP: "Google Cloud", ALI: "Alibaba Cloud", OCI: "Oracle Cloud", CUSTOMER: (window.CUSTOMER_NAME || "Customer") + " DC's" }[provider] || provider;
  }

  function createLocationMarker(record, point, color, isAvailabilityZone) {
    var marker = createSvgElement("circle", {
      cx: point.cx,
      cy: point.cy,
      r: markerRadius,
      fill: markerFillColor(record.csp),
      stroke: color,
      "stroke-width": ((isAvailabilityZone ? 2.25 : 2) * zoomScale()).toFixed(4)
    });
    marker.style.display = "none";
    marker.addEventListener("mouseenter", function(event) { showTooltip(marker, locationMessage(record), null, event); });
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
    var isCustomerLocation = marker.record && String(marker.record.csp || '').toUpperCase() === "CUSTOMER";
    return (!marker.isAvailabilityZone || availabilityZonesVisible) &&
      (!companyApprovedOnly || isCustomerLocation || (marker.record && marker.record.companyAccessStatus === "enabled"));
  }

  function updateProviderMarkers(provider, active) {
    providerSets[provider].forEach(function(marker) {
      marker.element.style.display = active && markerIsAllowed(marker) ? "" : "none";
    });
  }

  function calloutRegionFromCoordinates(lat, lon, country) {
    country = String(country || "").toLowerCase();
    if (lat < -60) return null;
    var menatCountries = ["algeria", "bahrain", "egypt", "iraq", "israel", "jordan", "kuwait", "lebanon", "libya", "morocco", "oman", "qatar", "saudi arabia", "tunisia", "turkey", "united arab emirates", "uae"];
    if (country && menatCountries.some(function(name) { return country.indexOf(name) !== -1; })) return "MENAT";
    // Trust the country name first; the latitude boxes below misplace southern Canada (Montreal, Toronto) and northern Mexico (Monterrey).
    if (country.indexOf("canada") !== -1) return "Canada";
    if (country.indexOf("united states") !== -1 || country === "usa" || country === "us") return "USA";
    if (country.indexOf("mexico") !== -1) return "LATAM";
    if (lat >= 49 && lon >= -141 && lon <= -52) return "Canada";
    if (lat >= 24 && lat < 49 && lon >= -130 && lon <= -60) return "USA";
    if (lon < -50 && lat < 24) return "LATAM";
    if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 65) return "Europe";
    if (lon >= 55 || (lon >= 20 && lat < 35)) return "AsiaPac";
    return lon < -50 ? "LATAM" : "MENAT";
  }

  function calloutRegion(marker) {
    var values = String(marker.record.coord || "").split(",");
    return calloutRegionFromCoordinates(Number(values[0]), Number(values[1]), marker.record.state || marker.record.country);
  }

  function applyCalloutRegionHighlight() {
    var dark = document.documentElement.dataset.theme === "dark";
    var colors = dark ? {
      Canada: "#1e3a5f", USA: "#5b4520", Europe: "#1d4b38", MENAT: "#5a3822", LATAM: "#542b4a", AsiaPac: "#3d3266"
    } : {
      Canada: "#e0efff", USA: "#fff4cc", Europe: "#e1f5e8", MENAT: "#ffecd9", LATAM: "#f9e4f1", AsiaPac: "#eee9ff"
    };
    var referencedRegions = {};
    Object.keys(providerSets).forEach(function(provider) {
      providerSets[provider].forEach(function(marker) {
        if (!markerIsAllowed(marker)) return;
        var isCustomer = String(marker.record.csp || "").toUpperCase() === "CUSTOMER";
        if ((calloutMode === "customer") !== isCustomer) return;
        var region = calloutRegion(marker);
        if (region) referencedRegions[region] = true;
      });
    });
    countryPaths.forEach(function(path) {
      var fill = referencedRegions[path.dataset.calloutRegion] ? colors[path.dataset.calloutRegion] : "";
      path.dataset.calloutFill = fill || "";
      if (!path.matches(":hover")) path.setAttribute("fill", fill || path.dataset.fill);
    });
  }

  function calloutAnchor(region) {
    var anchors = {
      Canada: [-100, 62], USA: [-100, 37], Europe: [15, 55], MENAT: [45, 25], LATAM: [-65, -15], AsiaPac: [120, 25]
    };
    var coord = anchors[region] || [0, 0];
    return parseLatLon(coord[1] + "," + coord[0]);
  }

  // Callout text is measured in the SVG so columns can be sized to the real text widths.
  var calloutTextWidths = {};
  var calloutMeasureNode = null;

  function textWidth(text, heading) {
    var key = (heading ? "h|" : "n|") + text;
    if (calloutTextWidths[key] === undefined) {
      calloutMeasureNode.setAttribute("font-size", heading ? "7.2" : "5.9");
      calloutMeasureNode.setAttribute("font-weight", heading ? "700" : "400");
      calloutMeasureNode.textContent = text;
      var measured = calloutMeasureNode.getComputedTextLength ? calloutMeasureNode.getComputedTextLength() : 0;
      calloutTextWidths[key] = measured || text.length * (heading ? 4.6 : 3.5);
    }
    return calloutTextWidths[key];
  }

  function fitText(row, maxWidth) {
    if (textWidth(row.text, row.heading) <= maxWidth) return row.text;
    var text = row.text;
    while (text.length > 1 && textWidth(text + "…", row.heading) > maxWidth) text = text.slice(0, -1);
    return text + "…";
  }

  function renderCallouts() {
    calloutLayer.replaceChildren();
    if (!calloutMode) return;
    calloutMeasureNode = createSvgElement("text", { visibility: "hidden" });
    calloutLayer.appendChild(calloutMeasureNode);
    var groups = {};
    Object.keys(providerSets).forEach(function(provider) {
      providerSets[provider].forEach(function(marker) {
        if (!markerIsAllowed(marker)) return;
        var isCustomer = String(marker.record.csp || "").toUpperCase() === "CUSTOMER";
        if ((calloutMode === "customer") !== isCustomer) return;
        var region = calloutRegion(marker);
        if (!region) return;
        if (!groups[region]) groups[region] = { region: region, countries: {} };
        var country = marker.record.state || marker.record.country || "Other";
        if (!groups[region].countries[country]) groups[region].countries[country] = [];
        groups[region].countries[country].push(marker);
      });
    });
    var providerOrder = ["AWS", "Azure", "GCP", "ALI", "OCI", "CUSTOMER"];
    var dark = document.documentElement.dataset.theme === "dark";
    Object.keys(groups).forEach(function(region) {
      var group = groups[region];
      var anchor = calloutAnchor(region);
      var rows = [];
      Object.keys(group.countries).sort().forEach(function(country) {
        if (country !== group.region) rows.push({ text: country, heading: true });
        group.countries[country].sort(function(a, b) {
          return providerOrder.indexOf(a.record.csp) - providerOrder.indexOf(b.record.csp);
        }).forEach(function(marker) {
          var record = marker.record;
          var code = record.code || record.region || record.location || "Location";
          var suffix = record.location && record.location !== code ? " (" + record.location + ")" : "";
          var provider = calloutMode === "customer"
            ? (record.availabilityZone ? "AZ" : "")
            : (record.availabilityZone ? "AZ " : "") + record.csp;
          rows.push({ provider: provider, text: code + suffix });
        });
      });
      var textPad = 6;
      var columnGap = 10;
      // Provider names share one column so the region names line up.
      var providerWidth = rows.reduce(function(widest, row) { return row.provider ? Math.max(widest, textWidth(row.provider, false) + 5) : widest; }, 0);
      var maxTextWidth = rows.reduce(function(widest, row) { return Math.max(widest, (row.provider ? providerWidth : 0) + textWidth(row.text, row.heading)); }, 0);
      var defaultColumnCount = rows.length > 12 ? 2 : 1;
      // Extra rows leave room for headings that get pushed to the next column.
      var defaultRowsPerColumn = Math.ceil((rows.length + defaultColumnCount - 1) / defaultColumnCount);
      var defaultBoxWidth = Math.min(mapWidth - 8, defaultColumnCount * (maxTextWidth + columnGap) - columnGap + textPad * 2);
      var defaultBoxHeight = 20 + defaultRowsPerColumn * 9;
      var positionKey = calloutMode + "|" + region;
      var savedSize = calloutSizes[positionKey] || { width: defaultBoxWidth, height: defaultBoxHeight };
      var boxWidth = clamp(savedSize.width, 130, mapWidth - 8);
      var boxHeight = clamp(savedSize.height, 38, mapHeight - 8);
      // As many columns as fit at the natural text width; leftover width is shared between them.
      var innerWidth = boxWidth - textPad * 2;
      var columnCount = clamp(Math.floor((innerWidth + columnGap) / (Math.min(maxTextWidth, innerWidth) + columnGap)), 1, 8);
      var columnWidth = (innerWidth + columnGap) / columnCount - columnGap;
      var columnStep = columnWidth + columnGap;
      var rowsPerColumn = Math.max(1, Math.floor((boxHeight - 20) / 9));
      var columns = [[]];
      var placedRows = 0;
      for (; placedRows < rows.length; placedRows++) {
        var row = rows[placedRows];
        var column = columns[columns.length - 1];
        // Start a new column when full, and never leave a country heading alone at the bottom.
        var needsNewColumn = column.length >= rowsPerColumn || (row.heading && column.length > 0 && column.length === rowsPerColumn - 1);
        if (needsNewColumn) {
          if (columns.length >= columnCount) break;
          column = [];
          columns.push(column);
        }
        column.push(row);
      }
      if (placedRows < rows.length) {
        var lastColumn = columns[columns.length - 1];
        while (lastColumn.length && (lastColumn.length >= rowsPerColumn || lastColumn[lastColumn.length - 1].heading)) lastColumn.pop();
        var shownRows = columns.reduce(function(sum, items) { return sum + items.length; }, 0);
        lastColumn.push({ text: "+" + (rows.length - shownRows) + " more", heading: false });
      }
      var leftEdge = region === "Canada" || region === "USA" || region === "LATAM";
      var defaultBoxX = leftEdge ? 12 : mapWidth - boxWidth - 12;
      var edgeRows = { Canada: 54, USA: 170, LATAM: 300, Europe: 54, AsiaPac: 210, MENAT: 350 };
      var defaultBoxY = clamp(edgeRows[region] || anchor.cy - boxHeight / 2, 4, mapHeight - boxHeight - 4);
      var savedPosition = calloutPositions[positionKey] || { x: defaultBoxX, y: defaultBoxY };
      var boxX = clamp(savedPosition.x, 4, mapWidth - boxWidth - 4);
      var boxY = clamp(savedPosition.y, 4, mapHeight - boxHeight - 4);
      var color = calloutMode === "customer" ? providerColor("CUSTOMER") : "#2563eb";
      var callout = createSvgElement("g", { "aria-label": region + " location summary" });
      callout.style.cursor = "move";
      callout.dataset.region = region;
      callout.appendChild(createSvgElement("line", {
        x1: anchor.cx, y1: anchor.cy, x2: leftEdge ? boxX + boxWidth : boxX, y2: boxY + boxHeight / 2,
        stroke: color, "stroke-width": "0.9", "stroke-opacity": "0.8"
      }));
      callout.appendChild(createSvgElement("circle", { cx: anchor.cx, cy: anchor.cy, r: "2", fill: color }));
      var boxGroup = createSvgElement("g", { transform: "translate(" + (boxX - defaultBoxX) + " " + (boxY - defaultBoxY) + ")" });
      boxGroup.appendChild(createSvgElement("rect", {
        x: defaultBoxX, y: defaultBoxY, width: boxWidth, height: boxHeight, rx: "3", fill: dark ? "#1e293b" : "#ffffff", stroke: color, "stroke-width": "0.9", "fill-opacity": "0.96"
      }));
      var title = createSvgElement("text", { x: defaultBoxX + 6, y: defaultBoxY + 12, fill: dark ? "#f8fafc" : "#172033", "font-size": "9", "font-weight": "700" });
      title.textContent = region;
      boxGroup.appendChild(title);
      columns.forEach(function(items, columnIndex) {
        items.forEach(function(row, rowIndex) {
          var text = createSvgElement("text", { x: defaultBoxX + textPad + columnIndex * columnStep, y: defaultBoxY + 22 + rowIndex * 9, fill: row.heading ? (dark ? "#f8fafc" : "#172033") : (dark ? "#cbd5e1" : "#475569"), "font-size": row.heading ? "7.2" : "5.9", "font-weight": row.heading ? "700" : "400" });
          var indent = row.provider ? providerWidth : 0;
          text.textContent = fitText(row, columnWidth - indent);
          if (row.provider) {
            var providerText = createSvgElement("text", { x: text.getAttribute("x"), y: text.getAttribute("y"), fill: text.getAttribute("fill"), "font-size": "5.9", "font-weight": "400" });
            providerText.textContent = row.provider;
            boxGroup.appendChild(providerText);
            text.setAttribute("x", Number(text.getAttribute("x")) + indent);
          }
          boxGroup.appendChild(text);
        });
      });
      var resizeHandle = createSvgElement("rect", { x: defaultBoxX + boxWidth - 9, y: defaultBoxY + boxHeight - 9, width: "7", height: "7", rx: "1", fill: color, opacity: "0.7" });
      resizeHandle.style.cursor = "nwse-resize";
      boxGroup.appendChild(resizeHandle);
      callout.appendChild(boxGroup);
      callout.addEventListener("pointerdown", function(event) {
        if (!calloutMode) return;
        event.preventDefault();
        event.stopPropagation();
        // boxX/boxY are only the position at render time; a previous drag updates calloutPositions.
        var current = calloutPositions[positionKey] || { x: boxX, y: boxY };
        calloutDrag = { callout: callout, line: callout.firstChild, boxGroup: boxGroup, key: positionKey, region: region, baseX: defaultBoxX, baseY: defaultBoxY, x: current.x, y: current.y, startX: event.clientX, startY: event.clientY, startBoxX: current.x, startBoxY: current.y, rect: map.getBoundingClientRect(), width: boxWidth, height: boxHeight };
        calloutPositions[positionKey] = { x: current.x, y: current.y };
        if (callout.setPointerCapture && typeof event.pointerId === "number") callout.setPointerCapture(event.pointerId);
      });
      callout.addEventListener("pointermove", moveCallout, { passive: false });
      callout.addEventListener("pointerup", endCallout);
      callout.addEventListener("pointercancel", endCallout);
      resizeHandle.addEventListener("pointerdown", function(event) {
        event.preventDefault();
        event.stopPropagation();
        calloutResize = { handle: resizeHandle, key: positionKey, startWidth: boxWidth, startHeight: boxHeight, startX: event.clientX, startY: event.clientY, rect: map.getBoundingClientRect() };
        if (resizeHandle.setPointerCapture && typeof event.pointerId === "number") resizeHandle.setPointerCapture(event.pointerId);
      });
      resizeHandle.addEventListener("pointermove", moveCalloutResize, { passive: false });
      resizeHandle.addEventListener("pointerup", endCalloutResize);
      resizeHandle.addEventListener("pointercancel", endCalloutResize);
      calloutLayer.appendChild(callout);
    });
  }


  function bringProviderToFront(provider) {
    providerSets[provider].forEach(function(marker) { markerLayer.appendChild(marker.element); });
  }

  function moveCallout(event) {
    if (!calloutDrag) return;
    var dx = (event.clientX - calloutDrag.startX) * viewBoxWidth() / calloutDrag.rect.width;
    var dy = (event.clientY - calloutDrag.startY) * viewBoxHeight() / calloutDrag.rect.height;
    calloutDrag.x = clamp(calloutDrag.startBoxX + dx, 4, mapWidth - calloutDrag.width - 4);
    calloutDrag.y = clamp(calloutDrag.startBoxY + dy, 4, mapHeight - calloutDrag.height - 4);
    calloutDrag.boxGroup.setAttribute("transform", "translate(" + (calloutDrag.x - calloutDrag.baseX) + " " + (calloutDrag.y - calloutDrag.baseY) + ")");
    var leftEdge = calloutDrag.x < mapWidth / 2;
    calloutDrag.line.setAttribute("x2", leftEdge ? calloutDrag.x + calloutDrag.width : calloutDrag.x);
    calloutDrag.line.setAttribute("y2", calloutDrag.y + calloutDrag.height / 2);
    calloutPositions[calloutDrag.key] = { x: calloutDrag.x, y: calloutDrag.y };
    event.preventDefault();
  }

  function endCallout(event) {
    if (!calloutDrag) return;
    calloutPositions[calloutDrag.key] = { x: calloutDrag.x, y: calloutDrag.y };
    if (calloutDrag.callout.releasePointerCapture && typeof event.pointerId === "number" && calloutDrag.callout.hasPointerCapture(event.pointerId)) calloutDrag.callout.releasePointerCapture(event.pointerId);
    calloutDrag = null;
  }

  function moveCalloutResize(event) {
    if (!calloutResize) return;
    calloutResize.width = clamp(calloutResize.startWidth + (event.clientX - calloutResize.startX) * viewBoxWidth() / calloutResize.rect.width, 130, mapWidth - 8);
    calloutResize.height = clamp(calloutResize.startHeight + (event.clientY - calloutResize.startY) * viewBoxHeight() / calloutResize.rect.height, 38, mapHeight - 8);
    event.preventDefault();
  }

  function endCalloutResize(event) {
    if (!calloutResize) return;
    calloutSizes[calloutResize.key] = { width: calloutResize.width || calloutResize.startWidth, height: calloutResize.height || calloutResize.startHeight };
    if (calloutResize.handle.releasePointerCapture && typeof event.pointerId === "number" && calloutResize.handle.hasPointerCapture(event.pointerId)) calloutResize.handle.releasePointerCapture(event.pointerId);
    calloutResize = null;
    renderCallouts();
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
    renderCallouts();
    if (result) result.textContent = matches.length ? matches.length + " location" + (matches.length === 1 ? "" : "s") + " highlighted" : "No matching region or AZ found";
  }

  function applyMarkerScale() {
    var scale = zoomScale();
    var correction = markerAspectCorrection();
    Object.keys(providerSets).forEach(function(provider) {
      providerSets[provider].forEach(function(marker) {
        marker.element.setAttribute("r", marker.radius * scale);
        marker.element.setAttribute("stroke-width", markerStrokeWidth(marker));
        compensateMarkerAspect(marker.element, correction);
      });
    });
    capitalMarkers.forEach(function(marker) {
      marker.element.setAttribute("r", marker.radius * scale);
      compensateMarkerAspect(marker.element, correction);
    });
    searchHighlights.forEach(function(highlight) {
      highlight.element.setAttribute("r", highlight.radius * scale);
      compensateMarkerAspect(highlight.element, correction);
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
      { id: "companyApprovedOnly", available: allMarkers.some(function(marker) {
        return marker.record && (String(marker.record.csp || '').toUpperCase() === "CUSTOMER" || marker.record.companyAccessStatus === "enabled");
      }) },
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
    if (calloutMode) return;
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
    applyViewBox(false);
    hideTooltip();
    event.preventDefault();
  }

  function endDrag(event) {
    if (!dragState || (typeof event.pointerId === "number" && event.pointerId !== dragState.id)) return;
    dragState = null;
    map.classList.remove("grabbing");
  }

  var background = createSvgElement("rect", { x: 0, y: 0, width: mapWidth, height: mapHeight, fill: "#dcecf4" });
  var scene = createSvgElement("g", { id: "mapScene" });
  var countryLayer = createSvgElement("g", { "aria-label": "World map" });
  var capitalLayer = createSvgElement("g", { "aria-label": "Country capitals" });
  var markerLayer = createSvgElement("g", { "aria-label": "Cloud provider locations" });
  var searchHighlightLayer = createSvgElement("g", { "aria-label": "Search highlights" });
  var calloutLayer = createSvgElement("g", { "aria-label": "Location callouts" });
  svg.setAttribute("viewBox", "0 0 " + mapWidth + " " + mapHeight);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "World map of cloud provider and customer data-center locations");
  map.appendChild(svg);
  scene.appendChild(background);
  scene.appendChild(countryLayer);
  scene.appendChild(capitalLayer);
  scene.appendChild(markerLayer);
  scene.appendChild(searchHighlightLayer);
  scene.appendChild(calloutLayer);
  svg.appendChild(scene);
  [-mapWidth, mapWidth].forEach(function(offset) {
    var wrappedScene = createSvgElement("use", {
      href: "#mapScene",
      x: offset,
      y: 0
    });
    wrappedScene.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#mapScene");
    svg.appendChild(wrappedScene);
  });

  (window.WORLD_GEOJSON.features || []).forEach(addCountryFeature);

  Object.keys(WORLD).forEach(function(countryCode) {
    var country = WORLD[countryCode];
    if (!country.capital) return;
    var capitalPoint = parseLatLon(country.capital[0]);
    var capital = createSvgElement("circle", { cx: capitalPoint.cx, cy: capitalPoint.cy, r: markerRadius, fill: "#6b46c1" });
    capital.style.display = "none";
    capital.addEventListener("mouseenter", function(event) { showTooltip(capital, country.capital[1], "city", event); });
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
    marker.addEventListener("mouseenter", function(event) { showTooltip(marker, city.name, "city", event); });
    marker.addEventListener("mouseleave", hideTooltip);
    capitalLayer.appendChild(marker);
    capitalMarkers.push({ element: marker, radius: markerRadius });
  });

  tooltip.className = "location-tooltip";
  tooltip.style.display = "none";
  map.appendChild(tooltip);
  function applyLoadedLocations() {
    if (!window.CSP_READY || applyLoadedLocations.applied) return;
    applyLoadedLocations.applied = true;
    addLocationRecords();
    setFeatureAvailability();
    updateAllProviders();
    updateMapTheme();
  }
  if (window.CSP_READY) applyLoadedLocations();
  else window.addEventListener("locations-ready", applyLoadedLocations, { once: true });
  applyViewBox(true);
  updateMapTheme();
  window.addEventListener("theme-changed", updateMapTheme);

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
    renderCallouts();
  });
  document.querySelector("#availabilityZones").addEventListener("change", function(event) {
    availabilityZonesVisible = event.target.checked;
    updateAllProviders();
    renderCallouts();
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
  if (locationSearch) {
    if (locationSearchButton) locationSearchButton.addEventListener("click", function() { highlightLocationSearch(locationSearch.value); });
    locationSearch.addEventListener("keydown", function(event) {
      if (event.key === "Enter") highlightLocationSearch(locationSearch.value);
    });
    locationSearch.addEventListener("blur", function() {
      highlightLocationSearch(locationSearch.value);
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
      renderCallouts();
    });
  });

  function bindCalloutToggle(id, mode) {
    var button = document.querySelector("#" + id);
    button.addEventListener("click", function() {
      calloutMode = calloutMode === mode ? null : mode;
      document.querySelector("#toggleCspCallouts").classList.toggle("pressed", calloutMode === "csp");
      document.querySelector("#toggleCustomerCallouts").classList.toggle("pressed", calloutMode === "customer");
      document.querySelector("#toggleCspCallouts").setAttribute("aria-pressed", String(calloutMode === "csp"));
      document.querySelector("#toggleCustomerCallouts").setAttribute("aria-pressed", String(calloutMode === "customer"));
      if (calloutMode) applyCalloutRegionHighlight();
      renderCallouts();
      if (!calloutMode) updateMapTheme();
      setMapNavigationLocked(Boolean(calloutMode));
    });
  }
  bindCalloutToggle("toggleCspCallouts", "csp");
  bindCalloutToggle("toggleCustomerCallouts", "customer");

  function setMapNavigationLocked(locked) {
    map.classList.toggle("summary-locked", locked);
    ["home", "plus", "minus"].forEach(function(id) {
      var button = document.querySelector("#" + id);
      button.disabled = locked;
      button.setAttribute("aria-disabled", String(locked));
    });
  }

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
    applyViewBox(true);
    hideTooltip();
  });

  if (window.PointerEvent) {
    map.addEventListener("pointerdown", beginDrag);
    map.addEventListener("pointermove", moveCallout, { passive: false });
    map.addEventListener("pointermove", moveDrag, { passive: false });
    map.addEventListener("pointerup", endDrag);
    map.addEventListener("pointerup", endCallout);
    map.addEventListener("pointercancel", endDrag);
    map.addEventListener("pointercancel", endCallout);
  } else {
    map.addEventListener("mousedown", beginDrag);
    document.addEventListener("mousemove", moveDrag, false);
    document.addEventListener("mouseup", endDrag, false);
  }
  map.addEventListener("wheel", function(event) {
    if (event.target.closest && event.target.closest("#mapControls")) return;
    if (calloutMode) {
      event.preventDefault();
      return;
    }
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
  if (window.ResizeObserver) new ResizeObserver(function() {
    hideTooltip();
    // Marker shapes are corrected for the map's aspect ratio, which changes with the window.
    applyMarkerScale();
  }).observe(map);
}

docReady(setupThemeControl);
docReady(initializeMap);
