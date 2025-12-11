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
  center: [22.0, 60.2],
  zoom: 6,
  pitch: 60,
  bearing: 0,
  attributionControl: false
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
