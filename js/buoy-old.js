// FMI Open Data integration for wave buoys

const FMI_BASE_URL = 'https://opendata.fmi.fi/wfs';
const BUOY_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes (same as FMI update frequency)

let buoyData = [];
let buoyUpdateTimer = null;

// Fetch wave buoy observations
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
        const xmlText = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        return parseBuoyXML(xmlDoc);
    } catch (error) {
        console.error('Error fetching buoy data:', error);
        return [];
    }
}

function parseBuoyXML(xmlDoc) {
    const buoys = [];
    const NS = {
        gml: 'http://www.opengis.net/gml/3.2',
        swe: 'http://www.opengis.net/swe/2.0',
        gmlcov: 'http://www.opengis.net/gmlcov/1.0'
    };
    
    // Get buoy positions and names
    const points = xmlDoc.getElementsByTagNameNS(NS.gml, 'Point');
    const positions = [];
    
    for (let point of points) {
        const nameEl = point.getElementsByTagNameNS(NS.gml, 'name')[0];
        const posEl = point.getElementsByTagNameNS(NS.gml, 'pos')[0];
        
        if (nameEl && posEl) {
            const [lat, lon] = posEl.textContent.trim().split(/\s+/).map(parseFloat);
            positions.push({
                id: point.getAttribute('gml:id'),
                name: nameEl.textContent,
                lat,
                lon
            });
        }
    }
    
    // Get parameter names (field order)
    const fields = xmlDoc.getElementsByTagNameNS(NS.swe, 'field');
    const paramNames = [];
    for (let field of fields) {
        paramNames.push(field.getAttribute('name'));
    }
    
    // Get data values
    const dataBlock = xmlDoc.getElementsByTagNameNS(NS.gml, 'doubleOrNilReasonTupleList')[0];
    if (!dataBlock) return buoys;
    
    const dataLines = dataBlock.textContent.trim().split('\n');
    
    // Group data by buoy (each buoy has multiple time points)
    const buoyLatestData = {};
    
    dataLines.forEach((line, idx) => {
        const values = line.trim().split(/\s+/);
        const buoyIdx = idx % positions.length;
        const buoyPos = positions[buoyIdx];
        
        if (!buoyLatestData[buoyPos.name]) {
            buoyLatestData[buoyPos.name] = {
                ...buoyPos,
                observations: {}
            };
        }
        
        // Parse values (skip NaN)
        paramNames.forEach((param, pIdx) => {
            const value = parseFloat(values[pIdx]);
            if (!isNaN(value)) {
                buoyLatestData[buoyPos.name].observations[param] = value;
            }
        });
    });
    
    return Object.values(buoyLatestData);
}

// Initialize buoy data fetching
export async function initBuoyData() {
    buoyData = await fetchBuoyData();
    console.log(`Loaded ${buoyData.length} wave buoys`);
    
    // Update periodically
    if (buoyUpdateTimer) clearInterval(buoyUpdateTimer);
    buoyUpdateTimer = setInterval(async () => {
        buoyData = await fetchBuoyData();
        if (window.updateBuoyMarkers) {
            window.updateBuoyMarkers(buoyData);
        }
    }, BUOY_UPDATE_INTERVAL);
    
    return buoyData;
}

export function getBuoyData() {
    return buoyData;
}

// Format buoy data for popup
export function formatBuoyPopup(buoy) {
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
    
    if (obs.WaveHs !== undefined) {
        html += `
            <div class="popup-row">
                <span class="label">Wave Height:</span>
                <span class="value">${obs.WaveHs.toFixed(1)} m</span>
            </div>`;
    }
    
    if (obs.ModalWDi !== undefined) {
        html += `
            <div class="popup-row">
                <span class="label">Wave Direction:</span>
                <span class="value">${Math.round(obs.ModalWDi)}°</span>
            </div>`;
    }
    
    if (obs.WTP !== undefined) {
        html += `
            <div class="popup-row">
                <span class="label">Wave Period:</span>
                <span class="value">${obs.WTP.toFixed(1)} s</span>
            </div>`;
    }
    
    if (obs.TWATER !== undefined) {
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
