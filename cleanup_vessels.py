#!/usr/bin/env python3
"""
Truncate only the `vessel_positions` table (safe helper).

Usage:
  export DATABASE_URL='postgres://user:pass@host:5432/db'
  python cleanup_vessels.py

You will be prompted to type YES to proceed. To skip prompt (use with care),
set environment variable `FORCE=YES`.
"""
import os
import sys
import psycopg2


def confirm():
    if os.environ.get('FORCE') == 'YES':
        return True
    print('This will TRUNCATE public.vessel_positions and RESTART IDENTITY.')
    print('Type YES to continue: ', end='', flush=True)
    try:
        if input().strip() == 'YES':
            return True
    except Exception:
        pass
    return False


def main():
    db = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')
    if not db:
        print('ERROR: set DATABASE_URL environment variable (Postgres DSN)')
        sys.exit(1)

    if not confirm():
        print('Aborted.')
        sys.exit(0)

    conn = psycopg2.connect(db)
    try:
        cur = conn.cursor()
        cur.execute('SELECT count(*) FROM public.vessel_positions;')
        before = cur.fetchone()[0]
        print('Rows before:', before)

        cur.execute('TRUNCATE TABLE public.vessel_positions RESTART IDENTITY CASCADE;')
        conn.commit()

        cur.execute('SELECT count(*) FROM public.vessel_positions;')
        after = cur.fetchone()[0]
        print('Rows after:', after)
        cur.close()
    finally:
        conn.close()


if __name__ == '__main__':
    main()
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
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')  # Use new secret key from Supabase dashboard

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
        # Support both line (boundaries) and polygon (territorial waters) geometries
        geom_type = feature['geometry']['type']
        if geom_type in ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']:
            geom = shape(feature['geometry'])
            # Try different property names for country identification
            country = (feature['properties'].get('TERRITORY1') or 
                      feature['properties'].get('Country') or 
                      feature['properties'].get('NAME') or
                      'Unknown')
            boundaries.append({
                'geometry': geom,
                'country': country,
                'type': geom_type
            })
    
    print(f"Loaded {len(boundaries)} territorial boundaries")
    return boundaries

def get_vessel_country(lon, lat, boundaries):
    """
    Determine which country's territorial waters a vessel is in.
    For LineString boundaries, uses distance threshold (12 nautical miles ≈ 0.2 degrees)
    For Polygon boundaries, uses containment check
    """
    point = Point(lon, lat)
    PROXIMITY_THRESHOLD = 0.2  # ~12 nautical miles in degrees
    
    for boundary in boundaries:
        geom_type = boundary['type']
        
        # For polygons, check if point is inside
        if geom_type in ['Polygon', 'MultiPolygon']:
            if boundary['geometry'].contains(point):
                return boundary['country']
        
        # For lines (boundary markers), check proximity
        elif geom_type in ['LineString', 'MultiLineString']:
            distance = boundary['geometry'].distance(point)
            if distance < PROXIMITY_THRESHOLD:
                return boundary['country']
    
    return None  # In international waters or far from boundaries

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
    """
    Delete ONLY the last 24h positions for vessels that didn't cross territorial boundaries.
    
    IMPORTANT: This preserves ALL historical data older than 24h!
    - If a vessel crossed boundaries 2 days ago, that data is kept
    - Only the most recent 24h is removed if no boundary crossing occurred
    - This prevents endless accumulation while preserving historical boundary crossings
    """
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
            
            # CRITICAL: .gte() ensures we delete ONLY last 24h, not entire history!
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
