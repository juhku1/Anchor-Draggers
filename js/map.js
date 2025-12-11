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
    // Marine Regions EEZ boundaries - includes all Baltic Sea countries
    // This GeoJSON contains Exclusive Economic Zones for Finland, Estonia, Sweden, Russia, etc.
    // Filtered to Baltic Sea region (bounds approximately match our map)
    const eezUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_boundary_lines_maritime_indicator.geojson';
    
    const response = await fetch(eezUrl);
    if (!response.ok) {
      console.warn('Failed to fetch maritime boundaries from Natural Earth');
      return;
    }
    
    const allData = await response.json();
    
    // Filter to only Baltic Sea region (our map bounds: 18-30.3°E, 58.5-66°N)
    const balticBounds = {
      west: 17,
      east: 31,
      south: 57,
      north: 67
    };
    
    const balticFeatures = allData.features.filter(feature => {
      if (!feature.geometry || !feature.geometry.coordinates) return false;
      
      // Check if any coordinate is within Baltic Sea bounds
      const coords = feature.geometry.coordinates;
      const checkCoords = (coordArray) => {
        if (typeof coordArray[0] === 'number') {
          const [lon, lat] = coordArray;
          return lon >= balticBounds.west && lon <= balticBounds.east &&
                 lat >= balticBounds.south && lat <= balticBounds.north;
        }
        return coordArray.some(c => checkCoords(c));
      };
      
      return checkCoords(coords);
    });
    
    const geojson = {
      type: 'FeatureCollection',
      features: balticFeatures
    };
    
    console.log('Maritime boundaries received:', geojson.features?.length, 'features in Baltic region');
    
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

// Export map instance
export function initMap() {
  return map;
}
