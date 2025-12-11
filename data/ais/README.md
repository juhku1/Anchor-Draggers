# AIS Data Collection

This directory contains historical AIS (Automatic Identification System) data collected from the Baltic Sea region.

## Data Structure

```
data/ais/
├── latest.json          # Most recent collection
├── YYYY-MM-DD/         # Daily directories
│   ├── HH-MM.json      # 10-minute snapshots
│   └── summary.csv     # Daily summary
```

## Data Format

Each JSON file contains:
- `timestamp`: ISO 8601 UTC timestamp
- `vessel_count`: Number of vessels in region
- `bbox`: Geographic bounding box
- `vessels`: Array of vessel features (GeoJSON format)

## Collection

Data is automatically collected every 10 minutes via GitHub Actions.

Source: [Digitraffic Marine API](https://meri.digitraffic.fi)

Region: Baltic Sea (17-30.3°E, 58.5-66°N)

## Usage

Access latest data:
```javascript
fetch('data/ais/latest.json')
  .then(r => r.json())
  .then(data => console.log(`${data.vessel_count} vessels`))
```

## Archive Policy

To manage repository size:
- Keep last 7 days of full data
- Archive older data as daily summaries
- Compress historical data
