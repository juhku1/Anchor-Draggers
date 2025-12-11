/**
 * Wave buoy monitoring module
 * Fetches FMI Open Data buoy observations and displays them on map
 */

const FMI_BASE_URL = 'https://opendata.fmi.fi/wfs';
const BUOY_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes

let buoyData = [];
let buoyMarkers = [];
let buoyUpdateTimer = null;

// ============================================================================
// FMI API Integration
// ============================================================================

async function fetchBuoyData() {
    try {
        const now = new Date();
        const startTime = new Date(now - 3 * 60 * 60 * 1000); // 3 hours ago
        
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            storedquery_id: 'fmi::observations::wave::multipointcoverage',
            starttime: startTime.toISOString(),
            endtime: now.toISOString()
        });
        
        const response = await fetch(`${FMI_BASE_URL}?${params}`);
        if (!response.ok) throw new Error('FMI API request failed');
        
        const xmlText = await response.text();
        return parseBuoyXML(xmlText);
    } catch (error) {
        console.error('Failed to fetch buoy data:', error);
        return [];
    }
}

function parseBuoyXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    const positions = xmlDoc.getElementsByTagNameNS('http://www.opengis.net/gml/3.2', 'pos');
    const names = xmlDoc.getElementsByTagNameNS('http://www.opengis.net/gml/3.2', 'name');
    const dataBlocks = xmlDoc.getElementsByTagNameNS('http://www.opengis.net/gml/3.2', 'doubleOrNilReasonTupleList');
    
    const buoys = [];
    const buoyLatestData = {};
    
    for (let i = 0; i < positions.length; i++) {
        const posText = positions[i].textContent.trim();
        const [lat, lon] = posText.split(' ').map(Number);
        const name = names[i]?.textContent.trim() || 'Unknown Buoy';
        
        if (dataBlocks[i]) {
            const rows = dataBlocks[i].textContent.trim().split('\n');
            for (let j = rows.length - 1; j >= 0; j--) {
                const row = rows[j].trim();
                if (!row) continue;
                
                const values = row.split(/\s+/).map(v => v === 'NaN' ? null : parseFloat(v));
                
                if (values.every(v => v === null)) continue;
                
                // FMI wave observation parameters:
                // [WaveHs, ModalWDi, WTP, TWATER, WHDD]
                const observations = {
                    WaveHs: values[0],      // Significant wave height (m)
                    ModalWDi: values[1],    // Modal wave direction (degrees)
                    WTP: values[2],         // Wave period (s)
                    TWATER: values[3],      // Water temperature (°C)
                    WHDD: values[4]         // Wave direction deviation
                };
                
                if (!buoyLatestData[name]) {
                    buoyLatestData[name] = {
                        name,
                        lat,
                        lon,
                        observations
                    };
                    break; // Use most recent non-null data
                }
            }
        }
    }
    
    return Object.values(buoyLatestData);
}

// ============================================================================
// Marker Management
// ============================================================================

function createBuoyMarker(buoy, map) {
  const el = document.createElement('div');
  el.className = 'buoy-marker';
  el.innerHTML = `
    <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
      <line x1="16" y1="8" x2="16" y2="1" stroke="#33" stroke-width="2" stroke-linecap="round"/>
      <circle cx="16" cy="0.5" r="1.5" fill="#ff6b00"/>
      <ellipse cx="16" cy="16" rx="12" ry="6" fill="#ffcc00" stroke="#cc9900" stroke-width="1.5"/>
      <ellipse cx="16" cy="15" rx="12" ry="5" fill="#ffe666"/>
      <ellipse cx="16" cy="14" rx="8" ry="3" fill="#fff" opacity="0.3"/>
    </svg>
  `;
  el.style.cursor = 'pointer';
  el.style.userSelect = 'none';
  
  const popupHtml = formatBuoyPopup(buoy);
  const popup = new maplibregl.Popup({ offset: 20, maxWidth: '280px' }).setHTML(popupHtml);
  
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([buoy.lon, buoy.lat])
    .setPopup(popup)
    .addTo(map);
  
  return marker;
}

function formatBuoyPopup(buoy) {
    const obs = buoy.observations;
    
    const buoyIcon = `<svg width="40" height="50" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
      <line x1="16" y1="8" x2="16" y2="1" stroke="#33" stroke-width="2" stroke-linecap="round"/>
      <circle cx="16" cy="0.5" r="1.5" fill="#ff6b00"/>
      <ellipse cx="16" cy="16" rx="12" ry="6" fill="#ffcc00" stroke="#cc9900" stroke-width="1.5"/>
      <ellipse cx="16" cy="15" rx="12" ry="5" fill="#ffe666"/>
      <ellipse cx="16" cy="14" rx="8" ry="3" fill="#fff" opacity="0.3"/>
    </svg>`;
    
    let html = `<div class="buoy-popup">
        <div class="popup-header">
            <div style="display: flex; align-items: center; gap: 8px;">
                ${buoyIcon}
                <strong>${buoy.name}</strong>
            </div>
        </div>
        <div class="popup-section">
            <div class="popup-row">
                <span class="value">${buoy.lat.toFixed(4)}°N, ${buoy.lon.toFixed(4)}°E</span>
            </div>`;
    
    if (obs.WaveHs !== undefined && obs.WaveHs !== null) {
        html += `
            <div class="popup-row">
                <span class="label">Wave Height:</span>
                <span class="value">${obs.WaveHs.toFixed(1)} m</span>
            </div>`;
    }
    
    if (obs.ModalWDi !== undefined && obs.ModalWDi !== null) {
        html += `
            <div class="popup-row">
                <span class="label">Wave Direction:</span>
                <span class="value">${Math.round(obs.ModalWDi)}°</span>
            </div>`;
    }
    
    if (obs.WTP !== undefined && obs.WTP !== null) {
        html += `
            <div class="popup-row">
                <span class="label">Wave Period:</span>
                <span class="value">${obs.WTP.toFixed(1)} s</span>
            </div>`;
    }
    
    if (obs.TWATER !== undefined && obs.TWATER !== null) {
        html += `
            <div class="popup-row">
                <span class="label">Water Temperature:</span>
                <span class="value">${obs.TWATER.toFixed(1)}°C</span>
            </div>`;
    }
    
    html += `
        </div>
        <div class="popup-footer">
            <small>Source: FMI Open Data</small>
        </div>
    </div>`;
    
    return html;
}

function updateBuoyMarkers(data, map) {
  // Remove old markers
  buoyMarkers.forEach(marker => marker.remove());
  buoyMarkers = [];
  
  // Create new markers
  data.forEach(buoy => {
    const marker = createBuoyMarker(buoy, map);
    buoyMarkers.push(marker);
  });
  
  console.log(`Updated ${buoyMarkers.length} buoy markers`);
}

// ============================================================================
// Public API
// ============================================================================

export async function initBuoys(map) {
    // Fetch initial data
    buoyData = await fetchBuoyData();
    console.log(`Loaded ${buoyData.length} wave buoys`);
    
    // Display on map
    updateBuoyMarkers(buoyData, map);
    
    // Setup periodic updates
    if (buoyUpdateTimer) clearInterval(buoyUpdateTimer);
    buoyUpdateTimer = setInterval(async () => {
        buoyData = await fetchBuoyData();
        updateBuoyMarkers(buoyData, map);
    }, BUOY_UPDATE_INTERVAL);
}
