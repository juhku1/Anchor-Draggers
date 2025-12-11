/**
 * Map initialization and main logic
 * Handles MapLibre GL setup, vessel markers, buoy markers, and real-time updates
 */

import { initBuoyData, getBuoyData, formatBuoyPopup } from './fmi.js';

// ============================================================================
// Map Setup
// ============================================================================

window.map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [22.0, 60.2],
  zoom: 6,
  pitch: 60,
  bearing: 0,
  attributionControl: false
});

const map = window.map; // Local alias for convenience

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.dragRotate.disable();
if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) {
  map.touchZoomRotate.disableRotation();
}

// ============================================================================
// State Management
// ============================================================================

let loading = false;
const vesselState = {};
const vesselMarkers = {};
const buoyMarkers = {};
let firstCenter = true;

// ============================================================================
// AIS Data Loading and Processing
// ============================================================================

async function loadAis() {
  if (loading) return;
  loading = true;
  try {
    if (!metadataLoaded) await fetchVesselMetadata();

    const data = await fetchAisLocations();

    resetStats();

    const latestByMmsi = {};

    // Process all features and calculate speeds
    data.features.forEach(feature => {
      const props = feature.properties || {};
      const mmsi = props.mmsi || feature.mmsi;
      if (!mmsi) return;
      const lat = feature.geometry.coordinates[1];
      const lon = feature.geometry.coordinates[0];
      const sog = (typeof props.sog === "number" ? props.sog : undefined);
      let calcSpeedKnots = null;
      const tsExt = props.timestampExternal;

      if (typeof tsExt === "number") {
        const prev = vesselState[mmsi];
        if (prev) {
          const dtMs = tsExt - prev.lastTimestampMs;
          const dtS = dtMs / 1000;
          if (dtS > 5 && dtS < 3600) {
            const distM = haversine(prev.lastLat, prev.lastLon, lat, lon);
            if (distM > 1) {
              calcSpeedKnots = distM * 3600 / (1852 * dtS);
            }
          }
        }
        vesselState[mmsi] = {
          lastLat: lat,
          lastLon: lon,
          lastTimestampMs: tsExt,
          lastCalcSpeedKnots: calcSpeedKnots
        };
      }
      latestByMmsi[mmsi] = feature;
    });

    let anyPosition = null;

    // Create or update markers for each vessel
    Object.values(latestByMmsi).forEach(feature => {
      const props = feature.properties || {};
      const mmsi = props.mmsi || feature.mmsi;
      if (!mmsi) return;

      const lat = feature.geometry.coordinates[1];
      const lon = feature.geometry.coordinates[0];
      anyPosition = anyPosition || [lon, lat];

      const meta = vesselMetadataByMmsi[mmsi] || {};
      const sog = (typeof props.sog === "number" ? props.sog : undefined);
      let calcSpeedKnots = (vesselState[mmsi] && typeof vesselState[mmsi].lastCalcSpeedKnots === "number")
        ? vesselState[mmsi].lastCalcSpeedKnots
        : null;

      const speed = (typeof calcSpeedKnots === "number" && isFinite(calcSpeedKnots))
        ? calcSpeedKnots
        : (typeof sog === "number" && isFinite(sog) ? sog : 0);

      let angle = (typeof props.heading === "number" && isFinite(props.heading))
        ? props.heading
        : (typeof props.cog === "number" && isFinite(props.cog) ? props.cog : 0);

      const shipType = meta.shipType;
      const color = shipTypeColor(shipType);

      const visualAngle = angle;
      const svgIcon = vesselSvg(speed, visualAngle, color);
      const name = meta.name || props.name || "Unknown vessel";

      const regCountry = getMmsiCountry(mmsi) || "–";
      const regIso2 = getCountryIso2FromMmsiCountry(regCountry);
      const regFlag = regIso2 ? flagImgTag(regIso2) : "";

      const typeName = shipTypeName(shipType);

      let destLabel = null;
      if (meta.destination) {
        const decoded = decodeDestination(meta.destination);
        destLabel = decoded || meta.destination;
      }

      const { cKey, tKey } = registerVesselForStats(regCountry, typeName, destLabel);

      // Get navigation status info
      const navStat = props.navStat;
      const navStatText = (navStat !== undefined) ? getNavStatText(navStat) : null;
      const navStatColor = (navStat !== undefined) ? getNavStatColor(navStat) : null;
      
      // Format ETA if available
      const etaText = meta.eta ? formatETA(meta.eta) : null;
      
      // Format ROT if available
      const rotText = (props.rot !== undefined && props.rot !== -128) ? formatROT(props.rot) : null;

      // Build popup HTML
      let popupHtml = `<div class="vessel-popup">`;
      
      // Header with name and type
      popupHtml += `<div class="popup-header">`;
      popupHtml += `<div class="popup-title">${safe(name)}</div>`;
      popupHtml += `<div class="popup-subtitle">${typeName}</div>`;
      popupHtml += `</div>`;
      
      // Primary info section
      popupHtml += `<div class="popup-section">`;
      
      // Flag with image
      popupHtml += `<div class="popup-row popup-row-flag">`;
      popupHtml += `<span class="label">Flag:</span>`;
      popupHtml += `<span class="value">${regCountry} ${regFlag}</span>`;
      popupHtml += `</div>`;
      
      // Navigation status with color indicator
      if (navStatText) {
        popupHtml += `<div class="popup-row">`;
        popupHtml += `<span class="label">Status:</span>`;
        popupHtml += `<span class="value"><span class="status-dot" style="background:${navStatColor}"></span>${navStatText}</span>`;
        popupHtml += `</div>`;
      }
      
      // Destination
      if (meta.destination) {
        const dest = (destLabel && destLabel !== meta.destination) ? `${destLabel}` : meta.destination;
        popupHtml += `<div class="popup-row"><span class="label">Dest:</span><span class="value">${dest}</span></div>`;
      }
      
      // ETA
      if (etaText) {
        popupHtml += `<div class="popup-row"><span class="label">ETA:</span><span class="value">${etaText}</span></div>`;
      }
      
      popupHtml += `</div>`;
      
      // Navigation data section
      popupHtml += `<div class="popup-section">`;
      popupHtml += `<div class="popup-row"><span class="label">SOG:</span><span class="value">${formatKnots(sog)}</span></div>`;
      if (props.cog !== undefined && props.cog !== 360) {
        popupHtml += `<div class="popup-row"><span class="label">COG:</span><span class="value">${props.cog}°</span></div>`;
      }
      if (typeof meta.draught === "number" && meta.draught > 0) {
        popupHtml += `<div class="popup-row"><span class="label">Draft:</span><span class="value">${formatMeters(meta.draught / 10)}</span></div>`;
      }
      if (typeof props.timestampExternal === "number") {
        popupHtml += `<div class="popup-row"><span class="label">Update:</span><span class="value">${formatTimestampMs(props.timestampExternal)}</span></div>`;
      }
      popupHtml += `</div>`;
      
      // Additional details (collapsible)
      let moreDetails = [];
      
      if (props.heading !== undefined && props.heading !== 511) {
        moreDetails.push(`<div class="popup-row"><span class="label">Heading:</span><span class="value">${props.heading}°</span></div>`);
      }
      
      if (meta.callSign) {
        moreDetails.push(`<div class="popup-row"><span class="label">Call:</span><span class="value">${meta.callSign}</span></div>`);
      }
      
      if (meta.imo) {
        moreDetails.push(`<div class="popup-row"><span class="label">IMO:</span><span class="value">${meta.imo}</span></div>`);
      }
      
      moreDetails.push(`<div class="popup-row"><span class="label">MMSI:</span><span class="value">${mmsi}</span></div>`);
      
      if (rotText) {
        moreDetails.push(`<div class="popup-row"><span class="label">ROT:</span><span class="value">${rotText}</span></div>`);
      }
      
      if (props.posAcc !== undefined) {
        const accuracy = props.posAcc ? "High" : "Low";
        moreDetails.push(`<div class="popup-row"><span class="label">Accuracy:</span><span class="value">${accuracy}</span></div>`);
      }
      
      if (meta.posType !== undefined && meta.posType !== 0) {
        moreDetails.push(`<div class="popup-row"><span class="label">Pos type:</span><span class="value">${getPosTypeText(meta.posType)}</span></div>`);
      }
      
      if (props.raim !== undefined) {
        const raim = props.raim ? "On" : "Off";
        moreDetails.push(`<div class="popup-row"><span class="label">RAIM:</span><span class="value">${raim}</span></div>`);
      }
      
      moreDetails.push(`<div class="popup-row"><span class="label">Position:</span><span class="value">${formatLatLon(lat, lon)}</span></div>`);
      
      if (moreDetails.length > 0) {
        popupHtml += `<details class="popup-details">`;
        popupHtml += `<summary class="popup-details-toggle">More details...</summary>`;
        popupHtml += `<div class="popup-section popup-details-content">`;
        popupHtml += moreDetails.join('');
        popupHtml += `</div>`;
        popupHtml += `</details>`;
      }
      
      popupHtml += `</div>`;

      // Create or update marker
      let markerData = vesselMarkers[mmsi];
      if (!markerData) {
        const el = document.createElement('div');
        el.className = "vessel-svg-icon";
        el.innerHTML = svgIcon;
        const popup = new maplibregl.Popup({ offset: 20 }).setHTML(popupHtml);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lon, lat])
          .setPopup(popup)
          .addTo(map);
        vesselMarkers[mmsi] = {
          marker,
          element: el,
          lastAngle: angle,
          lastSpeed: speed,
          color: color,
          countryKey: cKey,
          typeKey: tKey,
          destinationKey: destLabel || ""
        };
      } else {
        markerData.element.innerHTML = svgIcon;
        markerData.marker.setLngLat([lon, lat]);
        if (markerData.marker.getPopup()) {
          markerData.marker.getPopup().setHTML(popupHtml);
        }
        markerData.lastAngle = angle;
        markerData.lastSpeed = speed;
        markerData.color = color;
        markerData.countryKey = cKey;
        markerData.typeKey = tKey;
        markerData.destinationKey = destLabel || "";
      }
    });

    updateStatsPanel();
    applyFilters();

    // Center map on first load
    if (firstCenter && anyPosition) {
      map.flyTo({ center: anyPosition, zoom: 8, essential: true, bearing: 0 });
      firstCenter = false;
    }
  } catch (err) {
    console.error('Failed to load AIS data:', err);
  } finally {
    loading = false;
  }
}

// ============================================================================
// Buoy Management
// ============================================================================

function createBuoyMarker(buoy) {
  // Create custom buoy icon (yellow half-sphere with antenna)
  const el = document.createElement('div');
  el.className = 'buoy-marker';
  el.innerHTML = `
    <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
      <!-- Antenna/pole -->
      <line x1="16" y1="8" x2="16" y2="1" stroke="#333" stroke-width="2" stroke-linecap="round"/>
      <circle cx="16" cy="0.5" r="1.5" fill="#ff6b00"/>
      
      <!-- Buoy body (half sphere) -->
      <ellipse cx="16" cy="16" rx="12" ry="8" fill="#ffcc00" stroke="#cc9900" stroke-width="1.5"/>
      <ellipse cx="16" cy="15" rx="12" ry="6" fill="#ffe666"/>
      
      <!-- Shading for 3D effect -->
      <ellipse cx="16" cy="14" rx="8" ry="4" fill="#fff" opacity="0.3"/>
    </svg>
  `;
  el.style.cursor = 'pointer';
  el.style.userSelect = 'none';
  
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([buoy.lon, buoy.lat]);
  
  // Create popup
  const popup = new maplibregl.Popup({ offset: 25 })
    .setHTML(formatBuoyPopup(buoy));
  
  marker.setPopup(popup);
  marker.addTo(map);
  
  return marker;
}

function updateBuoyMarkers(buoyData) {
  // Remove old markers
  Object.values(buoyMarkers).forEach(marker => marker.remove());
  
  // Clear the object
  for (let key in buoyMarkers) {
    delete buoyMarkers[key];
  }
  
  // Add new markers
  buoyData.forEach(buoy => {
    const marker = createBuoyMarker(buoy);
    buoyMarkers[buoy.name] = marker;
  });
  
  console.log(`Updated ${buoyData.length} buoy markers`);
}

// Make updateBuoyMarkers available globally for FMI module
window.updateBuoyMarkers = updateBuoyMarkers;

// ============================================================================
// Initialization
// ============================================================================

map.on('load', async () => {
  loadMmsiCountry(() => {
    loadUnlocode(() => {
      loadAis();
      setInterval(loadAis, 60 * 1000);
    });
  });
  
  // Initialize buoy data
  const buoyData = await initBuoyData();
  updateBuoyMarkers(buoyData);
});
