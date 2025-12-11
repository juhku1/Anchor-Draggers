#!/usr/bin/env python3
"""
AIS Data Collector for Baltic Sea Region
Fetches vessel data from Digitraffic API and stores it for historical analysis
"""

import json
import requests
from datetime import datetime, timezone
import os
from pathlib import Path

# Baltic Sea bounding box (same as map bounds)
BBOX = {
    'min_lon': 17.0,
    'max_lon': 30.3,
    'min_lat': 58.5,
    'max_lat': 66.0
}

def fetch_ais_data():
    """Fetch current AIS data from Digitraffic API"""
    url = "https://meri.digitraffic.fi/api/ais/v1/locations"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data
    except Exception as e:
        print(f"Error fetching AIS data: {e}")
        return None

def filter_vessels(data):
    """Filter vessels within Baltic Sea region"""
    if not data or 'features' not in data:
        return []
    
    filtered = []
    for feature in data['features']:
        coords = feature['geometry']['coordinates']
        lon, lat = coords[0], coords[1]
        
        # Check if within bounding box
        if (BBOX['min_lon'] <= lon <= BBOX['max_lon'] and 
            BBOX['min_lat'] <= lat <= BBOX['max_lat']):
            filtered.append(feature)
    
    return filtered

def save_data(vessels, timestamp):
    """Save vessel data to timestamped file"""
    # Create directory structure: data/ais/YYYY-MM-DD/
    date_str = timestamp.strftime('%Y-%m-%d')
    time_str = timestamp.strftime('%H-%M')
    
    data_dir = Path('data/ais') / date_str
    data_dir.mkdir(parents=True, exist_ok=True)
    
    # Save full data
    filename = data_dir / f'{time_str}.json'
    
    output = {
        'timestamp': timestamp.isoformat(),
        'vessel_count': len(vessels),
        'bbox': BBOX,
        'vessels': vessels
    }
    
    with open(filename, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Saved {len(vessels)} vessels to {filename}")
    
    # Update latest.json for easy access
    latest_file = Path('data/ais/latest.json')
    with open(latest_file, 'w') as f:
        json.dump(output, f, indent=2)
    
    return filename

def save_summary(timestamp, vessel_count):
    """Append summary to daily log"""
    date_str = timestamp.strftime('%Y-%m-%d')
    summary_file = Path('data/ais') / date_str / 'summary.csv'
    
    # Create header if file doesn't exist
    if not summary_file.exists():
        with open(summary_file, 'w') as f:
            f.write('timestamp,vessel_count\n')
    
    # Append data
    with open(summary_file, 'a') as f:
        f.write(f'{timestamp.isoformat()},{vessel_count}\n')

def main():
    """Main collection routine"""
    print("=" * 60)
    print("AIS Data Collection Started")
    print("=" * 60)
    
    timestamp = datetime.now(timezone.utc)
    print(f"Collection time: {timestamp.isoformat()}")
    
    # Fetch data
    print("Fetching AIS data from Digitraffic...")
    data = fetch_ais_data()
    
    if not data:
        print("Failed to fetch data")
        return
    
    # Filter to Baltic region
    print("Filtering vessels in Baltic Sea region...")
    vessels = filter_vessels(data)
    print(f"Found {len(vessels)} vessels in region")
    
    # Save data
    save_data(vessels, timestamp)
    save_summary(timestamp, len(vessels))
    
    print("Collection complete!")
    print("=" * 60)

if __name__ == '__main__':
    main()
