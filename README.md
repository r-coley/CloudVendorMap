# CloudVendorMap
Plots the locations of the Cloud Vendor DataCenters

Exercise using Raphael javascript library to display cloud datacenter locations
gleaned from information obtained by published sources.

Example screenshot. 
![alt tag](Screenshot.png)

OCI records use Oracle's region identifiers and approximate city coordinates from the
[OCI regions documentation](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm).
Exact physical data-center coordinates are not generally public, so markers represent the
provider region's named location.

## Location data

Run `node scripts/refresh-locations.js` to rebuild `data/provider-locations.generated.json`.
Provider records are normalized from the current source data, while company-maintained fields
belong in `data/provider-locations.manual.json`. Manual entries are keyed by `provider:regionId`
and are merged without being overwritten. This supports fields such as `dataCenterAddress`,
`companyAccessStatus`, and private-cloud Alibaba locations.

Availability-zone locations can be recorded within a region using an `availabilityZones` array. Each zone may
include `id` or `name`, `coordinates` (`lat` and `lon`), `location`, `dataCenterAddress`, and
`companyAccessStatus`. AZ markers are shown with the `AZ Locations` control when coordinates are available.

Example manual override:

```json
{
  "GCP:europe-west2": {
    "availabilityZones": [
      {
        "id": "europe-west2-a",
        "name": "europe-west2-a",
        "location": "London",
        "coordinates": { "lat": 51.5072, "lon": -0.1276 },
        "dataCenterAddress": "",
        "companyAccessStatus": "enabled"
      }
    ]
  }
}
```
