/**
 * Utility functions for AIS data formatting and interpretation
 */

// Navigation status decoder
function getNavStatText(navStat) {
  const statuses = {
    0: "Under way",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted maneuverability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way sailing",
    15: "Unknown"
  };
  return statuses[navStat] || `Status ${navStat}`;
}

// Navigation status color
function getNavStatColor(navStat) {
  if (navStat === 0) return "#2ecc71"; // Under way = green
  if (navStat === 1) return "#3498db"; // At anchor = blue
  if (navStat === 5) return "#9b59b6"; // Moored = purple
  if (navStat === 7) return "#f39c12"; // Fishing = orange
  if (navStat === 6) return "#e74c3c"; // Aground = red
  return "#95a5a6"; // Other = gray
}

// ETA formatter (MMDDHHMM format to readable)
function formatETA(eta) {
  if (!eta || eta === 0) return null;
  
  const month = (eta >> 16) & 0x0F;
  const day = (eta >> 11) & 0x1F;
  const hour = (eta >> 6) & 0x1F;
  const minute = eta & 0x3F;
  
  if (month === 0 || day === 0) return null;
  if (hour === 24 || minute === 60) return null;
  
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = monthNames[month] || month;
  
  return `${monthName} ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Rate of turn formatter
function formatROT(rot) {
  if (rot === undefined || rot === null || rot === -128) return null;
  if (rot === 127) return "Right >720°/min";
  if (rot === -127) return "Left >720°/min";
  
  // ROT[IND] = (ROT[AIS] / 4.733)^2
  const rotInd = Math.sign(rot) * Math.pow(Math.abs(rot) / 4.733, 2);
  const direction = rotInd > 0 ? "Right" : "Left";
  
  return `${direction} ${Math.abs(rotInd).toFixed(1)}°/min`;
}

// Position type decoder
function getPosTypeText(posType) {
  const types = {
    0: "Undefined",
    1: "GPS",
    2: "GLONASS",
    3: "GPS/GLONASS",
    4: "Loran-C",
    5: "Chayka",
    6: "Integrated nav",
    7: "Surveyed",
    8: "Galileo",
    15: "Internal GNSS"
  };
  return types[posType] || `Type ${posType}`;
}
