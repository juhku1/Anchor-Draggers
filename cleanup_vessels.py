#!/usr/bin/env python3
"""
Cleanup script for AIS data
Removes vessels that haven't crossed international territorial waters in the last 24 hours
"""

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from shapely.geometry import Point, shape, LineString
from shapely.ops import nearest_points

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
        print("Error: supabase-py not installed. Install with: pip install supabase")
        return None
    except Exception as e:
        print(f"Error initializing Supabase client: {e}")
        return None

def load_territorial_waters():
    """Load territorial waters boundaries from GeoJSON"""
    boundaries_file = Path('baltic_maritime_boundaries.geojson')
    
    if not boundaries_file.exists():
        print(f"Error: {boundaries_file} not found")
        return []
    
    with open(boundaries_file, 'r') as f:
        data = json.load(f)
    
    # Convert GeoJSON features to Shapely geometries
    boundaries = []
    for feature in data['features']:
        if feature['geometry']['type'] in ['Polygon', 'MultiPolygon']:
            geom = shape(feature['geometry'])
            country = feature['properties'].get('TERRITORY1', 'Unknown')
            boundaries.append({
                'geometry': geom,
                'country': country
            })
    
    print(f"Loaded {len(boundaries)} territorial boundaries")
    return boundaries

def get_vessel_country(lon, lat, boundaries):
    """Determine which country's territorial waters a vessel is in (if any)"""
    point = Point(lon, lat)
    
    for boundary in boundaries:
        if boundary['geometry'].contains(point):
            return boundary['country']
    
    return None  # In international waters

def analyze_vessel_movements(supabase, boundaries, hours=24):
    """
    Analyze vessel movements over the last N hours
    Returns list of MMSIs that should be kept (crossed territorial boundaries)
    """
    # Calculate time threshold
    threshold_time = datetime.now(timezone.utc) - timedelta(hours=hours)
    threshold_str = threshold_time.isoformat()
    
    print(f"Analyzing movements since {threshold_str}")
    
    # Fetch all vessel positions from the last 24 hours
    # Order by MMSI and timestamp to track movements
    try:
        response = supabase.table('vessel_positions')\
            .select('mmsi, longitude, latitude, timestamp')\
            .gte('timestamp', threshold_str)\
            .order('mmsi')\
            .order('timestamp')\
            .execute()
        
        positions = response.data
        print(f"Found {len(positions)} position records in last {hours} hours")
        
    except Exception as e:
        print(f"Error fetching positions: {e}")
        return set()
    
    # Group positions by MMSI
    vessels = {}
    for pos in positions:
        mmsi = pos['mmsi']
        if mmsi not in vessels:
            vessels[mmsi] = []
        vessels[mmsi].append(pos)
    
    print(f"Tracking {len(vessels)} unique vessels")
    
    # Analyze each vessel's movement
    vessels_to_keep = set()
    vessels_to_delete = set()
    
    for mmsi, positions in vessels.items():
        if len(positions) < 2:
            # Not enough data, keep for now
            vessels_to_keep.add(mmsi)
            continue
        
        # Track which countries the vessel has been in
        countries_visited = set()
        for pos in positions:
            country = get_vessel_country(pos['longitude'], pos['latitude'], boundaries)
            if country:
                countries_visited.add(country)
        
        # If vessel has been in multiple countries' waters, it crossed boundaries
        if len(countries_visited) >= 2:
            vessels_to_keep.add(mmsi)
        else:
            vessels_to_delete.add(mmsi)
    
    print(f"Analysis complete:")
    print(f"  - Vessels crossing boundaries: {len(vessels_to_keep)}")
    print(f"  - Vessels to delete: {len(vessels_to_delete)}")
    
    return vessels_to_keep, vessels_to_delete

def delete_vessels(supabase, mmsi_set, hours=24):
    """Delete all positions for vessels in the given MMSI set from the last 24 hours"""
    if not mmsi_set:
        print("No vessels to delete")
        return
    
    threshold_time = datetime.now(timezone.utc) - timedelta(hours=hours)
    threshold_str = threshold_time.isoformat()
    
    # Convert set to list for query
    mmsi_list = list(mmsi_set)
    
    try:
        # Delete in batches to avoid query size limits
        batch_size = 100
        total_deleted = 0
        
        for i in range(0, len(mmsi_list), batch_size):
            batch = mmsi_list[i:i + batch_size]
            
            # Delete positions for these MMSIs from last 24h
            result = supabase.table('vessel_positions')\
                .delete()\
                .in_('mmsi', batch)\
                .gte('timestamp', threshold_str)\
                .execute()
            
            # Count deletions (this is approximate)
            batch_deleted = len(batch)
            total_deleted += batch_deleted
            print(f"Deleted batch {i//batch_size + 1}: ~{batch_deleted} vessel records")
        
        print(f"✓ Deleted records for {len(mmsi_set)} vessels")
        
    except Exception as e:
        print(f"Error deleting vessels: {e}")
        raise

def main():
    """Main cleanup routine"""
    print("=" * 60)
    print("AIS Data Cleanup Started")
    print("=" * 60)
    
    # Initialize Supabase
    supabase = get_supabase_client()
    if not supabase:
        print("Failed to initialize Supabase client")
        return
    
    # Load territorial boundaries
    boundaries = load_territorial_waters()
    if not boundaries:
        print("Failed to load territorial boundaries")
        return
    
    # Analyze vessel movements
    vessels_to_keep, vessels_to_delete = analyze_vessel_movements(supabase, boundaries, hours=24)
    
    # Delete vessels that didn't cross boundaries
    if vessels_to_delete:
        print(f"\nDeleting {len(vessels_to_delete)} vessels that didn't cross territorial boundaries...")
        delete_vessels(supabase, vessels_to_delete, hours=24)
    else:
        print("\nNo vessels to delete - all tracked vessels crossed territorial boundaries")
    
    print("\nCleanup complete!")
    print("=" * 60)

if __name__ == '__main__':
    main()
