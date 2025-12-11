/**
 * Data loading and utility functions
 * Handles CSV loading, API calls, and data formatting
 */

// Configuration
const DIGITRAFFIC_USER = "JuhaMatti/AISMapLibreDemo";
const UNLOCODE_URL = "https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv";

// Data storage
let mmsiCountry = {};
export let unlocodeMap = {};
let vesselMetadataByMmsi = {};
let metadataLoaded = false;

// Country mapping (MMSI country names to ISO2 codes)
const countryNameToIso2 = {
  "Finland": "FI", "Sweden": "SE", "Norway": "NO", "Denmark": "DK",
  "Estonia": "EE", "Latvia": "LV", "Lithuania": "LT", "Germany (Federal Republic of)": "DE",
  "Netherlands (Kingdom of the)": "NL", "Belgium": "BE",
  "United Kingdom of Great Britain and Northern Ireland": "GB", "Ireland": "IE",
  "Russian Federation": "RU", "Poland (Republic of)": "PL", "France": "FR", "Spain": "ES",
  "Portugal": "PT", "Portugal - Madeira": "PT", "Portugal - Azores": "PT", "Malta": "MT",
  "Greece": "GR", "Italy": "IT", "Iceland": "IS", "Cyprus (Republic of)": "CY",
  "United Kingdom of Great Britain and Northern Ireland - Gibraltar": "GI"
};

// ============================================================================
// CSV Parsing
// ============================================================================

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================================
// MMSI Country Data
// ============================================================================

export function loadMmsiCountry(callback) {
  fetch("mmsi_countries.csv")
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(csv => {
      mmsiCountry = {};
      csv.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith("Digit")) return;
        const parts = line.split(";");
        if (parts.length < 2) return;
        const digit = parts[0].trim();
        const country = parts[1].trim();
        if (digit && country) mmsiCountry[digit] = country;
      });
      if (callback) callback();
    })
    .catch(err => {
      if (callback) callback();
    });
}

export function getMmsiCountry(mmsi) {
  if (!mmsi) return "";
  const prefix = String(mmsi).substring(0, 3);
  return mmsiCountry[prefix] || "";
}

export function getIso2Code(mmsi) {
  const countryName = getMmsiCountry(mmsi);
  if (!countryName) return "";
  if (countryNameToIso2[countryName]) return countryNameToIso2[countryName];
  const mainName = countryName.split(" - ")[0].trim();
  if (countryNameToIso2[mainName]) return countryNameToIso2[mainName];
  const firstWord = countryName.split(" ")[0].trim();
  if (countryNameToIso2[firstWord]) return countryNameToIso2[firstWord];
  return "";
}

// ============================================================================
// UN/LOCODE Data
// ============================================================================

function loadUnlocode(callback) {
  fetch(UNLOCODE_URL)
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(csv => {
      unlocodeMap = {};
      const lines = csv.split(/\r?\n/);
      if (!lines.length) return;
      const header = splitCsvLine(lines[0]);
      const idxCountry = header.indexOf("Country");
      const idxLocation = header.indexOf("Location");
      const idxName = header.indexOf("Name");
      if (idxCountry === -1 || idxLocation === -1 || idxName === -1) return;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = splitCsvLine(line);
        const country = cols[idxCountry];
        const loc = cols[idxLocation];
        const name = cols[idxName];
        if (!country || !loc || !name) continue;
        const code = (country + loc).replace(/\s+/g, "").toUpperCase();
        unlocodeMap[code] = { name: name, country: country };
      }
      if (callback) callback();
    })
    .catch(err => {
      if (callback) callback();
    });
}

function normalizeDestinationCode(raw) {
  if (!raw) return null;
  return String(raw).replace(/\s+/g, "").toUpperCase();
}

function decodeDestination(raw) {
  const norm = normalizeDestinationCode(raw);
  if (!norm) return null;
  const entry = unlocodeMap[norm];
  if (!entry) return null;
  return `${entry.name}, ${entry.country}`;
}

// ============================================================================
// Digitraffic API
// ============================================================================

async function fetchVesselMetadata() {
  if (metadataLoaded) return;
  const url = "https://meri.digitraffic.fi/api/ais/v1/vessels";
  const res = await fetch(url, {
    headers: {
      "Digitraffic-User": DIGITRAFFIC_USER,
      "Accept": "application/json"
    }
  });
  if (!res.ok) return;
  const list = await res.json();
  for (const v of list) {
    if (!v || !v.mmsi) continue;
    vesselMetadataByMmsi[v.mmsi] = v;
  }
  metadataLoaded = true;
}

async function fetchAisLocations() {
  const thirtyMinutesMs = 30 * 60 * 1000;
  const from = Date.now() - thirtyMinutesMs;
  const url = "https://meri.digitraffic.fi/api/ais/v1/locations?from=" + from;
  const res = await fetch(url, {
    headers: {
      "Digitraffic-User": DIGITRAFFIC_USER,
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
  return await res.json();
}

// ============================================================================
// Utility Functions
// ============================================================================

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatKnots(value) {
  if (typeof value !== "number" || !isFinite(value)) return "–";
  return value.toFixed(1) + " kn";
}

function formatMeters(value) {
  if (typeof value !== "number" || !isFinite(value)) return "–";
  return value.toFixed(1) + " m";
}

function formatTimestampMs(tsMs) {
  if (typeof tsMs !== "number" || !isFinite(tsMs)) return "–";
  return new Date(tsMs).toLocaleString();
}

function formatLatLon(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return "–";
  return lat.toFixed(5) + ", " + lon.toFixed(5);
}

function safe(value, fallback = "–") {
  return (value === null || value === undefined || value === "") ? fallback : value;
}
