#!/usr/bin/env python3
"""
AIS Data Collector for Baltic Sea Region
Fetches vessel data from Digitraffic API and stores it in Supabase database
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

# Supabase configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://baeebralrmgccruigyle.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')

def get_supabase_client():
    """Initialize Supabase client"""
    try:
        from supabase import create_client, Client
        if not SUPABASE_KEY:
            raise ValueError("SUPABASE_KEY environment variable not set")
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except ImportError:
        print("Warning: supabase-py not installed. Install with: pip install supabase")
        return None
    except Exception as e:
        print(f"Error initializing Supabase client: {e}")
        return None

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

def fetch_vessel_metadata(mmsi_list):
    """Fetch vessel metadata (names, types, etc.) from Digitraffic"""
    url = "https://meri.digitraffic.fi/api/ais/v1/vessels"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        vessels = response.json()
        
        # Create lookup dict
        metadata = {}
        for vessel in vessels:
            mmsi = vessel.get('mmsi')
            if mmsi in mmsi_list:
                metadata[mmsi] = {
                    'name': vessel.get('name', '').strip(),
                    'ship_type': vessel.get('shipType'),
                    'destination': vessel.get('destination', '').strip(),
                    'eta': vessel.get('eta'),
                    'draught': vessel.get('draught')
                }
        
        return metadata
    except Exception as e:
        print(f"Warning: Could not fetch vessel metadata: {e}")
        return {}

def filter_vessels(data):
    """Filter moving vessels within Baltic Sea region"""
    if not data or 'features' not in data:
        return []
    
    filtered = []
    for feature in data['features']:
        coords = feature['geometry']['coordinates']
        lon, lat = coords[0], coords[1]
        props = feature['properties']
        sog = props.get('sog', 0)
        
        # Check if within bounding box AND moving (SOG > 0.5 knots)
        if (BBOX['min_lon'] <= lon <= BBOX['max_lon'] and 
            BBOX['min_lat'] <= lat <= BBOX['max_lat'] and
            sog > 0.5):
            filtered.append(feature)
    
    return filtered

def save_to_database(vessels, vessel_metadata, timestamp, collection_time_ms):
    """Save vessel data to Supabase database"""
    supabase = get_supabase_client()
    if not supabase:
        print("Skipping database save - Supabase not available")
        return
    
    timestamp_str = timestamp.isoformat()
    
    try:
        # Prepare vessel data for batch insert
        vessel_data = []
        for feature in vessels:
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            mmsi = props.get('mmsi')
            
            # Get metadata if available
            meta = vessel_metadata.get(mmsi, {})
            
            vessel_data.append({
                'timestamp': timestamp_str,
                'mmsi': mmsi,
                'name': meta.get('name'),
                'longitude': coords[0],
                'latitude': coords[1],
                'sog': props.get('sog'),
                'cog': props.get('cog'),
                'heading': props.get('heading'),
                'nav_stat': props.get('navStat'),
                'ship_type': meta.get('ship_type'),
                'destination': meta.get('destination'),
                'eta': meta.get('eta'),
                'draught': meta.get('draught'),
                'pos_acc': props.get('posAcc')
            })
        
        # Batch insert vessels (Supabase has 1000 row limit per request)
        batch_size = 1000
        for i in range(0, len(vessel_data), batch_size):
            batch = vessel_data[i:i + batch_size]
            result = supabase.table('vessel_positions').insert(batch).execute()
            print(f"Inserted batch {i//batch_size + 1}: {len(batch)} vessels")
        
        # Insert collection summary
        summary = {
            'timestamp': timestamp_str,
            'vessel_count': len(vessels),
            'collection_time_ms': collection_time_ms
        }
        supabase.table('collection_summary').insert(summary).execute()
        
        print(f"✓ Saved {len(vessels)} vessels to Supabase")
        
    except Exception as e:
        print(f"Error saving to Supabase: {e}")
        raise

def export_latest_json(vessels, vessel_metadata, timestamp):
    """Export latest data as JSON for web access"""
    latest_file = Path('data/ais/latest.json')
    
    # Build simplified vessel list
    vessel_list = []
    for feature in vessels:
        props = feature['properties']
        coords = feature['geometry']['coordinates']
        mmsi = props.get('mmsi')
        meta = vessel_metadata.get(mmsi, {})
        
        vessel_list.append({
            'mmsi': mmsi,
            'name': meta.get('name'),
            'lon': coords[0],
            'lat': coords[1],
            'sog': props.get('sog'),
            'cog': props.get('cog'),
            'heading': props.get('heading'),
            'ship_type': meta.get('ship_type'),
            'destination': meta.get('destination')
        })
    
    output = {
        'timestamp': timestamp.isoformat(),
        'vessel_count': len(vessel_list),
        'vessels': vessel_list
    }
    
    with open(latest_file, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Exported latest.json with {len(vessel_list)} vessels")

def main():
    """Main collection routine"""
    print("=" * 60)
    print("AIS Data Collection Started")
    print("=" * 60)
    
    start_time = datetime.now(timezone.utc)
    timestamp = start_time
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
    
    # Fetch vessel metadata (names, types, etc.)
    print("Fetching vessel metadata...")
    mmsi_list = [f['properties']['mmsi'] for f in vessels]
    vessel_metadata = fetch_vessel_metadata(mmsi_list)
    print(f"Retrieved metadata for {len(vessel_metadata)} vessels")
    
    # Calculate collection time
    collection_time = datetime.now(timezone.utc) - start_time
    collection_time_ms = int(collection_time.total_seconds() * 1000)
    
    # Save to Supabase
    save_to_database(vessels, vessel_metadata, timestamp, collection_time_ms)
    
    # Export latest JSON
    export_latest_json(vessels, vessel_metadata, timestamp)
    
    print(f"Collection complete in {collection_time_ms}ms!")
    print("=" * 60)

if __name__ == '__main__':
    main()
