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
    [17.0, 58.5],   // Southwest corner [lng, lat] - western limit extended 100km west of Stockholm
    [30.3, 66.0]    // Northeast corner [lng, lat] - eastern limit at St. Petersburg (30.31°E)
  ]
});

// Add navigation controls
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Disable rotation
map.dragRotate.disable();
if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) {
  map.touchZoomRotate.disableRotation();
}

// ============================================================================
// Territorial Waters Boundary Layer
// ============================================================================

map.on('load', () => {
  // Add territorial sea boundary (12 nautical miles) from Traficom
  // Official maritime boundaries from Finnish Transport and Communications Agency
  map.addSource('territorial-waters', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [] // Will be populated from WFS
    }
  });
  
  // Add territorial labels source
  map.addSource('territorial-labels', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });
  
  // Fetch territorial waters boundary from HELCOM
  fetchTerritorialWaters();
  
  // Load territorial labels
  loadTerritorialLabels();
});

async function fetchTerritorialWaters() {
  try {
    // Load HELCOM territorial waters dataset (12 nautical miles boundaries)
    // Source: HELCOM (European Environment Agency + OpenStreetMap + Swedish Maritime Administration)
    // Data: https://metadata.helcom.fi/geonetwork/srv/eng/catalog.search#/metadata/8a393266-519d-4eaa-a94b-b67f9f589744
    
    const response = await fetch('baltic_maritime_boundaries.geojson');
    if (!response.ok) {
      console.warn('Failed to fetch maritime boundaries');
      return;
    }
    
    const geojson = await response.json();
    console.log('HELCOM territorial waters loaded:', geojson.features?.length, 'features');
    
    // Update source with fetched data
    if (map.getSource('territorial-waters')) {
      map.getSource('territorial-waters').setData(geojson);
      
      // Add line layer for territorial waters boundary
      // Layer added early so it appears UNDER vessel/buoy markers
      if (!map.getLayer('territorial-waters-line')) {
        // Find the first symbol layer to insert boundary lines before it
        const layers = map.getStyle().layers;
        let firstSymbolId;
        for (const layer of layers) {
          if (layer.type === 'symbol') {
            firstSymbolId = layer.id;
            break;
          }
        }
        
        map.addLayer({
          id: 'territorial-waters-line',
          type: 'line',
          source: 'territorial-waters',
          paint: {
            'line-color': '#00eaff',
            'line-width': 2,
            'line-opacity': 0.6,
            'line-dasharray': [4, 2]
          }
        }, firstSymbolId); // Insert before first symbol layer (labels, markers will be on top)
      }
      
      console.log('Territorial waters boundary layer added (under markers)');
    }
  } catch (error) {
    console.error('Error loading territorial waters:', error);
  }
}

async function loadTerritorialLabels() {
  try {
    const response = await fetch('territorial_labels.geojson');
    if (!response.ok) {
      console.warn('Failed to fetch territorial labels');
      return;
    }
    
    const geojson = await response.json();
    
    if (map.getSource('territorial-labels')) {
      map.getSource('territorial-labels').setData(geojson);
      
      // Add text layer for territorial water labels
      if (!map.getLayer('territorial-labels-text')) {
        map.addLayer({
          id: 'territorial-labels-text',
          type: 'symbol',
          source: 'territorial-labels',
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 27,
            'text-letter-spacing': 0.3,
            'text-transform': 'uppercase',
            'text-allow-overlap': false,
            'text-pitch-alignment': 'viewport', // Text stays upright when map tilts
            'text-rotation-alignment': 'viewport' // Text rotates with map rotation
          },
          paint: {
            'text-color': '#00eaff',
            'text-opacity': 0.4,
            'text-halo-color': '#001a33',
            'text-halo-width': 2,
            'text-halo-blur': 1
          }
        });
        
        console.log('Territorial labels added');
      }
    }
  } catch (error) {
    console.error('Error loading territorial labels:', error);
  }
}

// Export map instance
export function initMap() {
  return map;
}
