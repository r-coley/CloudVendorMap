# Project structure

This document describes the main files in Cloud & Customer Data Center Locations.

## Repository tree

```text
CloudVendorMap/
├── index.html
├── README.md
├── css/
│   ├── iconHome.png
│   ├── iconMinus.png
│   ├── iconPlus.png
│   └── style.css
├── data/
│   ├── locations.customer.json       # Private, Git-ignored customer locations
│   ├── locations.csp.json             # Generated/downloadable cloud-provider dataset
│   └── ref/                           # Fixed reference data
│       ├── locations.manual.json     # Manual overrides and additions
│       ├── locations.source.json     # Canonical non-OCI provider records
│       └── world-countries.geojson   # Country boundaries for the map
├── doc/
│   ├── customer-dc-json-format.txt   # Customer JSON format guide
│   ├── project-structure.md          # This document
│   ├── screenshot.png                # Current UI screenshot
│   └── NOTE.txt                      # Project notes
├── js/
│   ├── data-loader.js                # Loads and merges location data
│   ├── main.js                       # Map rendering and interactions
│   ├── maps.js                       # Capital and reference-city data
│   └── world-loader.js               # Loads country-boundary GeoJSON
└── scripts/
    ├── create-local-cert.sh          # Creates a local HTTPS certificate
    ├── local-server.js               # Local HTTP/HTTPS server
    ├── oci-regions.js                # Collects OCI region data
    └── refresh-locations.js          # Rebuilds the generated dataset
```

## Location data flow

1. `ref/locations.source.json` provides the canonical non-OCI provider records.
2. `refresh-locations.js` reads that source, collects current OCI records, and applies
   `ref/locations.manual.json` overrides.
3. The result is written to `locations.csp.json`.
4. The browser loads `locations.csp.json` at runtime.
5. The browser then loads the private `locations.customer.json` file and merges its
   records into the runtime dataset.

`locations.customer.json` is excluded from Git. It contains a company name and a
`locations` array, for example:

```json
{
  "customerName": "Example Corp",
  "locations": [
    {
      "provider": "CUSTOMER",
      "regionId": "customer-london-1",
      "location": "London",
      "country": "United Kingdom",
      "coordinates": { "lat": 51.5072, "lon": -0.1276 }
    }
  ]
}
```

## Local server

Start HTTP mode with:

```bash
node scripts/local-server.js
```

For HTTPS, create the local certificate once and start the server with:

```bash
./scripts/create-local-cert.sh
node scripts/local-server.js --https
```

The Upload JSON and Download JSON controls use the Customer/Cloud slider to choose
which file they operate on. Uploads require the local server because they write to
the selected JSON file on disk.
