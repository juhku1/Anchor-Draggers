/**
 * Wave buoy monitoring module
 * Fetches FMI Open Data buoy observations and displays them on map
 */

const FMI_BASE_URL = 'https://opendata.fmi.fi/wfs';
const BUOY_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Known FMI wave buoy stations (coordinates to names)
const KNOWN_BUOYS = {
    '60.12333_24.97283': 'Helsinki Suomenlinna',
    '59.24817_20.99833': 'Pohjois-Itämeri',
    '59.96500_25.23500': 'Suomenlahti',
    '61.80010_20.23267': 'Selkämeri',
    '59.75720_23.22000': 'Hanko Längden'
};

let buoyData = [];
const buoyMarkers = {}; // Changed to object keyed by buoy name, like vessels
let buoyUpdateTimer = null;

// ============================================================================
// FMI API Integration
// ============================================================================

async function fetchBuoyData() {
    try {
        const now = new Date();
        const startTime = new Date(now - 60 * 60 * 1000); // 1 hour ago
        
        // Use simple observation format instead of multipointcoverage
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            storedquery_id: 'fmi::observations::wave::simple',
            starttime: startTime.toISOString(),
            endtime: now.toISOString()
        });
        
        const response = await fetch(`${FMI_BASE_URL}?${params}`);
        if (!response.ok) throw new Error('FMI API request failed');
        
        const xmlText = await response.text();
        return parseBuoyXMLSimple(xmlText);
    } catch (error) {
        console.error('Failed to fetch buoy data:', error);
        return [];
    }
}

function parseBuoyXMLSimple(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // Parse simple observation format - each member is a separate observation
    const members = xmlDoc.getElementsByTagName('wfs:member');
    const buoyLatestData = {};
    
    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        
        // Get position
        const posElem = member.getElementsByTagName('gml:pos')[0];
        if (!posElem) continue;
        const posText = posElem.textContent.trim();
        const [lat, lon] = posText.split(' ').map(Number);
        
        // Create coordinate key for lookup
        const coordKey = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
        const name = KNOWN_BUOYS[coordKey] || `Buoy ${lat.toFixed(2)}°N ${lon.toFixed(2)}°E`;
        
        // Get parameter name and value
        const paramElem = member.getElementsByTagName('BsWfs:ParameterName')[0];
        const valueElem = member.getElementsByTagName('BsWfs:ParameterValue')[0];
        
        if (!paramElem || !valueElem) continue;
        
        const paramName = paramElem.textContent.trim();
        const valueText = valueElem.textContent.trim();
        const value = valueText === 'NaN' ? null : parseFloat(valueText);
        
        // Initialize buoy data if not exists
        if (!buoyLatestData[name]) {
            buoyLatestData[name] = {
                name,
                lat,
                lon,
                observations: {
                    WaveHs: null,
                    ModalWDi: null,
                    WTP: null,
                    TWATER: null,
                    WHDD: null
                }
            };
        }
        
        // Store observation value (keep latest non-null value)
        if (buoyLatestData[name].observations.hasOwnProperty(paramName)) {
            if (value !== null || buoyLatestData[name].observations[paramName] === null) {
                buoyLatestData[name].observations[paramName] = value;
            }
        }
    }
    
    const result = Object.values(buoyLatestData);
    console.log(`Parsed ${result.length} buoys:`, result.map(b => `${b.name} (${Object.values(b.observations).filter(v => v !== null).length} params)`
        
        // Store observation value
        if (buoyLatestData[name].observations.hasOwnProperty(paramName)) {
            buoyLatestData[name].observations[paramName] = value;
        }
    }
    
    const result = Object.values(buoyLatestData);
    console.log(`Parsed ${result.length} buoys:`, result.map(b => b.name));
    return result;
}

// ============================================================================
// Marker Management
// ============================================================================

function formatBuoyPopup(buoy) {
    const obs = buoy.observations;
    
    const buoyIcon = `<svg width="40" height="28" viewBox="0 0 32 22" xmlns="http://www.w3.org/2000/svg">
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
  // Update or create markers (like vessel.js logic)
  data.forEach(buoy => {
    const key = buoy.name;
    const popupHtml = formatBuoyPopup(buoy);
    
    let markerData = buoyMarkers[key];
    if (!markerData) {
      // Create new marker
      const el = document.createElement('div');
      el.className = 'buoy-marker';
      el.innerHTML = `
        <svg width="32" height="22" viewBox="0 0 32 22" xmlns="http://www.w3.org/2000/svg">
          <line x1="16" y1="8" x2="16" y2="1" stroke="#33" stroke-width="2" stroke-linecap="round"/>
          <circle cx="16" cy="0.5" r="1.5" fill="#ff6b00"/>
          <ellipse cx="16" cy="16" rx="12" ry="6" fill="#ffcc00" stroke="#cc9900" stroke-width="1.5"/>
          <ellipse cx="16" cy="15" rx="12" ry="5" fill="#ffe666"/>
          <ellipse cx="16" cy="14" rx="8" ry="3" fill="#fff" opacity="0.3"/>
        </svg>
      `;
      el.style.cursor = 'pointer';
      el.style.userSelect = 'none';
      
      const popup = new maplibregl.Popup({ offset: 20, maxWidth: '280px' }).setHTML(popupHtml);
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([buoy.lon, buoy.lat])
        .setPopup(popup)
        .addTo(map);
      
      buoyMarkers[key] = { marker, element: el, popup };
    } else {
      // Update existing marker
      markerData.marker.setLngLat([buoy.lon, buoy.lat]);
      markerData.popup.setHTML(popupHtml);
    }
  });
  
  console.log(`Updated ${Object.keys(buoyMarkers).length} buoy markers`);
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
