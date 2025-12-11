/**
 * Data loading and API functions (ES6 Module)
 * Handles CSV loading, API calls, and data management
 */

// Configuration
const DIGITRAFFIC_USER = "JuhaMatti/AISMapLibreDemo";
const UNLOCODE_URL = "https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv";

// Data storage
let mmsiCountry = {};
export let unlocodeMap = {};
export let vesselMetadataByMmsi = {};
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

export async function loadMmsiCountry() {
  try {
    const res = await fetch("mmsi_countries.csv");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();
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
  } catch (err) {
    console.error("Failed to load MMSI country data:", err);
  }
}

function getMmsiCountry(mmsi) {
  if (!mmsi) return "";
  const prefix = String(mmsi).substring(0, 3);
  return mmsiCountry[prefix] || "";
}

export function getCountryName(mmsi) {
  return getMmsiCountry(mmsi) || "–";
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

export async function loadUnlocode() {
  try {
    const res = await fetch(UNLOCODE_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();
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
  } catch (err) {
    console.error("Failed to load UN/LOCODE data:", err);
  }
}

// ============================================================================
// Digitraffic API
// ============================================================================

export async function fetchVesselMetadata() {
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

export async function fetchAisLocations() {
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
