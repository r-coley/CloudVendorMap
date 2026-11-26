window.WORLD_READY = false;

fetch('./data/world-countries.geojson')
  .then(function(response) {
    if (!response.ok) throw new Error('Could not load geographic boundary data');
    return response.json();
  })
  .then(function(world) {
    window.WORLD_GEOJSON = world;
    window.WORLD_READY = true;
    window.dispatchEvent(new Event('world-ready'));
  })
  .catch(function(error) {
    console.warn('Using the legacy map boundaries:', error.message);
    window.WORLD_READY = true;
    window.dispatchEvent(new Event('world-ready'));
  });
