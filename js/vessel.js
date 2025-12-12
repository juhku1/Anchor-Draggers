/**
 * Vessel tracking and visualization module
 * Handles AIS vessel markers, popups, statistics, and filtering
 */

import { loadMmsiCountry, loadUnlocode, fetchVesselMetadata, fetchAisLocations, getCountryName, getIso2Code, unlocodeMap, vesselMetadataByMmsi } from './data.js';
import { getNavStatText, getNavStatColor, formatKnots, formatMeters, formatTimestampMs, formatLatLon, getPosTypeText, formatROT } from './utils.js';

// ============================================================================
// State
// ============================================================================

const vesselMarkers = {};
const stats = {
  total: 0,
  byCountry: {},
  byType: {},
  byDestination: {}
};
const filterState = {
  countries: new Set(),
  types: new Set(),
  destinations: new Set()
};
let activeTab = 'flags';
let loading = false;
let firstCenter = true;

// ============================================================================
// Ship Type Classification
// ============================================================================

function shipTypeColor(shipType) {
  if (shipType === undefined || shipType === null) return "#888";
  if (shipType >= 60 && shipType < 70) return "#3a9eea";  // Passenger
  if (shipType >= 70 && shipType < 80) return "#f3c300";  // Cargo
  if (shipType >= 30 && shipType < 40) return "#e84e1b";  // Fishing
  if (shipType >= 80 && shipType < 90) return "#2ecc71";  // Tanker
  if (shipType >= 90) return "#ad00ff";                    // Other special
  if (shipType >= 20 && shipType < 30) return "#aaaaaa";  // Tug/Pusher
  if (shipType >= 50 && shipType < 60) return "#1abc9c";  // Pilot/SAR
  return "#888";
}

function shipTypeName(shipType) {
  if (shipType === undefined || shipType === null) return "Unknown";
  if (shipType >= 20 && shipType < 30) return "Wing-in-ground/Tug/Pusher";
  if (shipType >= 30 && shipType < 40) return "Fishing";
  if (shipType >= 40 && shipType < 50) return "High-speed craft";
  if (shipType >= 50 && shipType < 60) return "Pilot/SAR";
  if (shipType >= 60 && shipType < 70) return "Passenger";
  if (shipType >= 70 && shipType < 80) return "Cargo";
  if (shipType >= 80 && shipType < 90) return "Tanker";
  if (shipType >= 90) return "Other special";
  return "Other/Unknown";
}

// ============================================================================
// SVG Icon Generation
// ============================================================================

function vesselSvg(speed, angle, color) {
  const rounded = (typeof speed === "number" && isFinite(speed) && speed > 0)
    ? Math.round(speed)
    : "";
  const rot = (typeof angle === "number" && isFinite(angle)) ? angle : 0;
  return `
    <svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(${rot}deg)">
      <polygon points="22,4 38,40 22,32 6,40" fill="${color}" stroke="#222" stroke-width="2"/>
      <text x="22" y="26" font-family="Arial" font-size="13" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">${rounded}</text>
    </svg>
  `;
}

function flagImgTag(iso2) {
  if (!iso2) return "";
  return `<img class="flag-img" src="https://flagcdn.com/24x18/${iso2.toLowerCase()}.png" alt="${iso2} flag" loading="lazy">`;
}

// ============================================================================
// Statistics
// ============================================================================

function resetStats() {
  stats.total = 0;
  stats.byCountry = {};
  stats.byType = {};
  stats.byDestination = {};
}

function registerVesselForStats(countryName, typeName, destinationLabel) {
  const cKey = countryName && countryName !== "–" ? countryName : "Unknown";
  const tKey = typeName || "Unknown";
  stats.total += 1;
  if (!stats.byCountry[cKey]) stats.byCountry[cKey] = 0;
  stats.byCountry[cKey] += 1;
  if (!stats.byType[tKey]) stats.byType[tKey] = 0;
  stats.byType[tKey] += 1;
  if (destinationLabel) {
    if (!stats.byDestination[destinationLabel]) stats.byDestination[destinationLabel] = 0;
    stats.byDestination[destinationLabel] += 1;
  }
  return { cKey, tKey };
}

// ============================================================================
// Filtering
// ============================================================================

function vesselPassesFilter(markerData) {
  const cSet = filterState.countries;
  const tSet = filterState.types;
  const dSet = filterState.destinations;
  const cKey = markerData.countryKey || "Unknown";
  const tKey = markerData.typeKey || "Unknown";
  const dKey = markerData.destinationKey || "";
  if (cSet.size > 0 && !cSet.has(cKey)) return false;
  if (tSet.size > 0 && !tSet.has(tKey)) return false;
  if (dSet.size > 0 && !dSet.has(dKey)) return false;
  return true;
}

function applyFilters() {
  Object.values(vesselMarkers).forEach(md => {
    const visible = vesselPassesFilter(md);
    if (md.element) {
      md.element.style.display = visible ? "" : "none";
    }
  });
  // Show/hide clear filter button
  const clearBtn = document.getElementById("clear-filter");
  const hasActiveFilters = filterState.countries.size > 0 || 
                           filterState.types.size > 0 || 
                           filterState.destinations.size > 0;
  if (clearBtn) {
    clearBtn.classList.toggle("active", hasActiveFilters);
    if (hasActiveFilters) {
      clearBtn.innerHTML = "✕";
      clearBtn.title = "Clear all filters";
      clearBtn.style.display = "inline-flex";
    } else {
      clearBtn.innerHTML = "";
      clearBtn.title = "No filters active";
      clearBtn.style.display = "none";
    }
  }
}

function wireStatsFilterHandlers() {
  // Tab switching
  document.querySelectorAll(".stats-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      activeTab = tab.getAttribute("data-tab");
      updateStatsPanel();
    });
  });

  // Filter checkboxes
  document.querySelectorAll(".flag-filter").forEach(cb => {
    cb.addEventListener("change", e => {
      const key = e.target.getAttribute("data-key");
      if (!key) return;
      if (e.target.checked) filterState.countries.add(key);
      else filterState.countries.delete(key);
      applyFilters();
    });
  });
  document.querySelectorAll(".type-filter").forEach(cb => {
    cb.addEventListener("change", e => {
      const key = e.target.getAttribute("data-key");
      if (!key) return;
      if (e.target.checked) filterState.types.add(key);
      else filterState.types.delete(key);
      applyFilters();
    });
  });
  document.querySelectorAll(".dest-filter").forEach(cb => {
    cb.addEventListener("change", e => {
      const key = e.target.getAttribute("data-key");
      if (!key) return;
      if (e.target.checked) filterState.destinations.add(key);
      else filterState.destinations.delete(key);
      applyFilters();
    });
  });

  // Clear filter button handler
  const clearBtn = document.getElementById("clear-filter");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      filterState.countries.clear();
      filterState.types.clear();
      filterState.destinations.clear();
      applyFilters();
      // Uncheck all checkboxes
      document.querySelectorAll(".flag-filter, .type-filter, .dest-filter").forEach(cb => cb.checked = false);
    });
  }
}

// ============================================================================
// Statistics Panel UI
// ============================================================================

function updateStatsPanel() {
  // Vaihda headerin teksti
  const headerTitle = document.querySelector('.stats-header-title');
  if (headerTitle) headerTitle.textContent = 'FILTER VESSELS';

  const el = document.getElementById("stats-content");
  if (!el) return;
  if (stats.total === 0) {
    el.innerHTML = "No vessels on the map in the last fetch.";
    return;
  }

  const allCountryEntries = Object.entries(stats.byCountry)
    .sort((a, b) => b[1] - a[1]);
  const allTypeEntries = Object.entries(stats.byType)
    .sort((a, b) => b[1] - a[1]);
  const destinationEntries = Object.entries(stats.byDestination)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  let html = "";
  html += `<div class="stats-summary"><strong>Vessels:</strong> ${stats.total}</div>`;
  
  // Tab navigation
  html += `<div class="stats-tabs">
    <button class="stats-tab ${activeTab === 'flags' ? 'active' : ''}" data-tab="flags">FLAGS</button>
    <button class="stats-tab ${activeTab === 'types' ? 'active' : ''}" data-tab="types">TYPES</button>
    <button class="stats-tab ${activeTab === 'destinations' ? 'active' : ''}" data-tab="destinations">DEST</button>
  </div>`;

  html += `<div class="stats-tab-content">`;

  if (activeTab === 'flags') {
    html += `<div class="stats-scrollable">`;
    allCountryEntries.forEach(([c, n]) => {
      const checked = filterState.countries.has(c) ? "checked" : "";
      html += `<label class="stats-filter-label">
                 <input type="checkbox" class="flag-filter" data-key="${c}" ${checked}>
                 ${c} (${n})
               </label>`;
    });
    html += `</div>`;
  }

  if (activeTab === 'types') {
    html += `<div class="stats-scrollable">`;
    allTypeEntries.forEach(([t, n]) => {
      const checked = filterState.types.has(t) ? "checked" : "";
      html += `<label class="stats-filter-label">
                 <input type="checkbox" class="type-filter" data-key="${t}" ${checked}>
                 ${t} (${n})
               </label>`;
    });
    html += `</div>`;
  }

  if (activeTab === 'destinations') {
    html += `<div class="stats-scrollable">`;
    if (destinationEntries.length) {
      destinationEntries.forEach(([d, n]) => {
        const checked = filterState.destinations.has(d) ? "checked" : "";
        html += `<label class="stats-filter-label">
                   <input type="checkbox" class="dest-filter" data-key="${d}" ${checked}>
                   ${d} <span class="stats-count">(${n})</span>
                 </label>`;
      });
    } else {
      html += `<div class="stats-empty">No destination data available</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
  wireStatsFilterHandlers();
}

function toggleStatsPanel(forceState) {
  const panel = document.getElementById("stats-panel");
  const arrow = document.getElementById("stats-panel-arrow");
  if (!panel) return;
  let collapsed;
  if (typeof forceState === "boolean") {
    collapsed = forceState;
    panel.classList.toggle("stats-panel-collapsed", collapsed);
  } else {
    panel.classList.toggle("stats-panel-collapsed");
    collapsed = panel.classList.contains("stats-panel-collapsed");
  }
  if (arrow) {
    arrow.innerHTML = collapsed ? "&#x25B2;" : "&#x25BC;";
  }
}

function initUIHandlers() {
  const header = document.getElementById("stats-header");
  if (header) {
    header.addEventListener("click", function(e) {
      toggleStatsPanel();
      e.stopPropagation();
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        toggleStatsPanel();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }
  // Clear filter button handler
  const clearFilterBtn = document.getElementById("clear-filter");
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      // Clear all filters
      filterState.countries.clear();
      filterState.types.clear();
      filterState.destinations.clear();
      // Show all vessels
      applyFilters();
      // Update stats panel to uncheck all boxes
      updateStatsPanel();
    });
  }
  document.addEventListener("click", function(e) {
    const panel = document.getElementById("stats-panel");
    const header = document.getElementById("stats-header");
    if (!panel || !header) return;
    if (!panel.contains(e.target)) {
      if (!panel.classList.contains("stats-panel-collapsed")) {
        toggleStatsPanel(true);
      }
    }
  });

  // License modal handlers
  const modal = document.getElementById("license-modal");
  const moreLink = document.getElementById("license-more");
  const closeBtn = document.querySelector(".license-close");

  if (moreLink) {
    moreLink.addEventListener("click", function(e) {
      e.preventDefault();
      if (modal) modal.style.display = "flex";
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", function() {
      if (modal) modal.style.display = "none";
    });
  }

  if (modal) {
    modal.addEventListener("click", function(e) {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && modal && modal.style.display === "flex") {
      modal.style.display = "none";
    }
  });
}

// ============================================================================
// AIS Data Loading and Marker Management
// ============================================================================

async function loadAis(map) {
  if (loading) return;
  loading = true;
  try {
    await fetchVesselMetadata();
    const data = await fetchAisLocations();
    
    resetStats();
    let anyPosition = null;

    data.features.forEach((feat) => {
      const props = feat.properties || {};  // AIS position data (mmsi, sog, cog, heading, etc.)
      const mmsi = props.mmsi;
      if (!mmsi) return;
      
      const lat = feat.geometry.coordinates[1];
      const lon = feat.geometry.coordinates[0];

      if (!anyPosition) anyPosition = [lon, lat];

      const meta = vesselMetadataByMmsi[mmsi] || {};  // Vessel metadata (name, shipType, destination, etc.)
      const shipType = meta.shipType;
      const sog = props.sog;
      const visualAngle = (props.heading !== undefined && props.heading !== 511)
        ? props.heading
        : props.cog;

      const regCountry = getCountryName(mmsi);
      const regIso2 = getIso2Code(mmsi);
      const regFlag = regIso2 ? flagImgTag(regIso2) : "";

      const color = shipTypeColor(shipType);
      const svgIcon = vesselSvg(sog, visualAngle, color);

      const typeName = shipTypeName(shipType);
      const name = meta.name || `MMSI ${mmsi}`;

      const navStatText = (props.navStat !== undefined) ? getNavStatText(props.navStat) : null;
      const navStatColor = (props.navStat !== undefined) ? getNavStatColor(props.navStat) : "#888";

      // Format ETA with date and time on separate lines
      let etaFormatted = null;
      if (meta.eta !== undefined && meta.eta !== 0) {
        const etaDate = new Date(meta.eta);
        const datePart = etaDate.toLocaleDateString("en-GB", { timeZone: "UTC" });
        const timePart = etaDate.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: '2-digit', minute: '2-digit', timeZoneName: "short" });
        etaFormatted = `${datePart}<br>${timePart}`;
      }

      let destLabel = "";
      if (meta.destination) {
        const destUp = meta.destination.trim().toUpperCase().replace(/[^A-Z]/g, "");
        if (destUp.length >= 2) {
          const foundEntry = unlocodeMap[destUp];
          if (foundEntry && foundEntry.name) {
            destLabel = foundEntry.name;
          }
        }
      }

      const { cKey, tKey } = registerVesselForStats(regCountry, typeName, destLabel);
      const rotText = (props.rot !== undefined && props.rot !== -128) ? formatROT(props.rot) : null;
      
      // Format update timestamp with date and time on separate lines
      let updateFormatted = null;
      if (typeof props.timestampExternal === "number") {
        const updateDate = new Date(props.timestampExternal);
        const datePart = updateDate.toLocaleDateString("en-GB", { timeZone: "UTC" });
        const timePart = updateDate.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: '2-digit', minute: '2-digit', timeZoneName: "short" });
        updateFormatted = `${datePart}<br>${timePart}`;
      }

      // Build popup HTML
      let popupHtml = `<div class="vessel-popup">`;
      
      // Header: Name and status
      popupHtml += `<div class="popup-header">`;
      popupHtml += `<div class="popup-title">${name}</div>`;
      popupHtml += `<div class="popup-subtitle" style="margin-top:6px">${typeName} · ${regCountry} ${regFlag}</div>`;
      if (navStatText) {
        popupHtml += `<div style="margin-top:4px"><span class="status-dot" style="background:${navStatColor}"></span> ${navStatText}</div>`;
      }
      popupHtml += `</div>`;
      
      // Main info section
      popupHtml += `<div class="popup-section popup-scrollable">`;
      
      if (meta.destination) {
        const dest = (destLabel && destLabel !== meta.destination) ? `${destLabel}` : meta.destination;
        popupHtml += `<div class="popup-row"><span class="label">Destination:</span><span class="value">${dest}</span></div>`;
      }
      
      if (etaFormatted) {
        popupHtml += `<div class="popup-row"><span class="label">ETA:</span><span class="value">${etaFormatted}</span></div>`;
      }
      
      popupHtml += `<div class="popup-row"><span class="label">Speed:</span><span class="value">${formatKnots(sog)}</span></div>`;
      
      if (props.cog !== undefined && props.cog !== 360) {
        popupHtml += `<div class="popup-row"><span class="label">Course:</span><span class="value">${props.cog}°</span></div>`;
      }
      
      if (typeof meta.draught === "number" && meta.draught > 0) {
        popupHtml += `<div class="popup-row"><span class="label">Draft:</span><span class="value">${formatMeters(meta.draught / 10)}</span></div>`;
      }
      
      if (props.heading !== undefined && props.heading !== 511) {
        popupHtml += `<div class="popup-row"><span class="label">Heading:</span><span class="value">${props.heading}°</span></div>`;
      }
      
      popupHtml += `</div>`;
      
      // Technical details section
      popupHtml += `<div class="popup-section" style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.1)">`;
      
      popupHtml += `<div class="popup-row"><span class="value">${formatLatLon(lat, lon)}</span></div>`;
      
      if (updateFormatted) {
        popupHtml += `<div class="popup-row" style="margin-top:6px"><span class="label">Updated:</span><span class="value">${updateFormatted}</span></div>`;
      }
      
      if (meta.callSign) {
        popupHtml += `<div class="popup-row"><span class="label">Call Sign:</span><span class="value">${meta.callSign}</span></div>`;
      }
      
      if (meta.imo) {
        popupHtml += `<div class="popup-row"><span class="label">IMO:</span><span class="value">${meta.imo}</span></div>`;
      }
      
      popupHtml += `<div class="popup-row"><span class="label">MMSI:</span><span class="value">${mmsi}</span></div>`;
      
      popupHtml += `</div>`;
      popupHtml += `</div>`;

      // Create or update marker
      let markerData = vesselMarkers[mmsi];
      if (!markerData) {
        const el = document.createElement('div');
        el.className = 'vessel-svg-icon';
        el.innerHTML = svgIcon;
        const popup = new maplibregl.Popup({ offset: 22, maxWidth: '280px', closeButton: false }).setHTML(popupHtml);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lon, lat])
          .setPopup(popup)
          .addTo(map);
        vesselMarkers[mmsi] = {
          marker,
          element: el,
          popup,
          countryKey: cKey,
          typeKey: tKey,
          destinationKey: destLabel || ""
        };
      } else {
        markerData.marker.setLngLat([lon, lat]);
        markerData.element.innerHTML = svgIcon;
        markerData.popup.setHTML(popupHtml);
        markerData.countryKey = cKey;
        markerData.typeKey = tKey;
        markerData.destinationKey = destLabel || "";
      }
    });

    updateStatsPanel();
    applyFilters();

    // Don't auto-center on first load - keep initial Gulf of Finland view
    // if (firstCenter && anyPosition) {
    //   map.flyTo({ center: anyPosition, zoom: 8, essential: true, bearing: 0 });
    //   firstCenter = false;
    // }
  } catch (err) {
    console.error("Failed to load AIS data:", err);
  } finally {
    loading = false;
  }
}

// ============================================================================
// Public API
// ============================================================================

export async function initVessels(map) {
  // Initialize UI handlers
  initUIHandlers();
  
  // Load data dependencies
  await loadMmsiCountry();
  await loadUnlocode();
  
  // Start vessel tracking
  await loadAis(map);
  setInterval(() => loadAis(map), 60 * 1000);
}
