/**
 * Visualization and UI
 * Handles vessel rendering, statistics, and filtering
 */

import { vesselMarkers } from './map.js';

// ============================================================================
// Ship Type Classification
// ============================================================================

export function shipTypeColor(shipType) {
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

export function shipTypeName(shipType) {
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
// Vessel SVG Icon Generation
// ============================================================================

export function vesselSvg(speed, angle, color) {
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

// ============================================================================
// Flag Icons
// ============================================================================

export function flagImgTag(iso2) {
  if (!iso2) return "";
  return `<img class="flag-img" src="https://flagcdn.com/24x18/${iso2.toLowerCase()}.png" alt="${iso2} flag" loading="lazy">`;
}

// ============================================================================
// Statistics
// ============================================================================

const stats = {
  total: 0,
  byCountry: {},
  byType: {},
  byDestination: {}
};

export function resetStats() {
  stats.total = 0;
  stats.byCountry = {};
  stats.byType = {};
  stats.byDestination = {};
}

export function registerVesselForStats(countryName, typeName, destinationLabel) {
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

const filterState = {
  countries: new Set(),
  types: new Set(),
  destinations: new Set()
};

let activeTab = 'flags';

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

export function applyFilters() {
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
    clearBtn.style.display = hasActiveFilters ? "inline-flex" : "none";
    console.log("Clear filter button:", hasActiveFilters ? "visible" : "hidden", 
                "Filters:", filterState.countries.size, filterState.types.size, filterState.destinations.size);
  }
}

function wireStatsFilterHandlers() {
  // Tab switching
  document.querySelectorAll(".stats-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent header click handler from closing panel
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
}

// ============================================================================
// Statistics Panel UI
// ============================================================================

export function updateStatsPanel() {
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

  // Tab content
  html += `<div class="stats-tab-content">`;

  // FLAGS tab
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

  // TYPES tab
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

  // DESTINATIONS tab
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

// Initialize stats panel toggle handlers
export function initUIHandlers() {
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
      e.stopPropagation(); // Prevent header click from toggling panel
      
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
