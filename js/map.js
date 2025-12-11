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
    [18.0, 58.5],   // Southwest corner [lng, lat] - western limit at Stockholm (18.06°E)
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
  
  // Fetch territorial waters boundary from Traficom WFS
  fetchTerritorialWaters();
});

async function fetchTerritorialWaters() {
  try {
    // Traficom WFS service for maritime boundaries (aluevesien rajat)
    // This includes: territorial sea (12 NM), internal waters, EEZ, and national borders at sea
    const wfsUrl = 'https://julkinen.traficom.fi/inspirepalvelu/avoin/wfs';
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: 'au:AdministrativeBoundary', // INSPIRE administrative boundaries
      outputFormat: 'application/json',
      srsName: 'EPSG:4326'
    });
    
    const response = await fetch(`${wfsUrl}?${params}`);
    if (!response.ok) {
      console.warn('Failed to fetch territorial waters from Traficom');
      return;
    }
    
    const geojson = await response.json();
    console.log('Territorial waters data received:', geojson.features?.length, 'features');
    
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
            'line-width': 1.5,
            'line-opacity': 0.4,
            'line-dasharray': [4, 3]
          }
        }, firstSymbolId); // Insert before first symbol layer (labels, markers will be on top)
      }
      
      console.log('Territorial waters boundary layer added (under markers)');
    }
  } catch (error) {
    console.error('Error loading territorial waters:', error);
  }
}

// Export map instance
export function initMap() {
  return map;
}
