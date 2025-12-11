/**
 * MapLibre GL map initialization
 * Provides base map setup and exports map instance
 */

// ============================================================================
// Map Setup
// ============================================================================

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [24.9, 60.0],  // Gulf of Finland, centered more north towards Helsinki
  zoom: 8,
  pitch: 60,
  bearing: 340,  // Northwest direction towards Helsinki
  attributionControl: false,
  maxBounds: [
    [10.0, 58.5],   // Southwest corner [lng, lat] - prevents going too far south (50km north from 58.0)
    [35.0, 66.0]    // Northeast corner [lng, lat] - covers Baltic Sea region
  ]
});

// Add navigation controls
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Disable rotation
map.dragRotate.disable();
if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) {
  map.touchZoomRotate.disableRotation();
}

// Export map instance
export function initMap() {
  return map;
}
