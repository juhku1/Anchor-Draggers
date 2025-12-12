#!/usr/bin/env python3
"""
Truncate `vessel_positions` and `collection_summary` and restart identities.

Usage:
  export DATABASE_URL='postgres://user:pass@host:5432/db'
  python cleanup_all_history.py

Requires typing YES to confirm or set FORCE=YES.
"""
import os
import sys
import psycopg2


def confirm():
    if os.environ.get('FORCE') == 'YES':
        return True
    print('This will TRUNCATE vessel_positions and collection_summary and RESTART IDENTITY.')
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
        before_v = cur.fetchone()[0]
        cur.execute('SELECT count(*) FROM public.collection_summary;')
        before_s = cur.fetchone()[0]
        print(f'Rows before: vessel_positions={before_v}, collection_summary={before_s}')

        cur.execute('TRUNCATE TABLE public.vessel_positions RESTART IDENTITY CASCADE;')
        cur.execute('TRUNCATE TABLE public.collection_summary RESTART IDENTITY CASCADE;')
        conn.commit()

        cur.execute('SELECT count(*) FROM public.vessel_positions;')
        after_v = cur.fetchone()[0]
        cur.execute('SELECT count(*) FROM public.collection_summary;')
        after_s = cur.fetchone()[0]
        print(f'Rows after: vessel_positions={after_v}, collection_summary={after_s}')
        cur.close()
    finally:
        conn.close()


if __name__ == '__main__':
    main()
#!/usr/bin/env python3
"""
One-time full cleanup: Analyze entire database history
Keeps only vessels that have EVER crossed territorial boundaries
"""

import json
import os
from pathlib import Path
from shapely.geometry import Point, shape

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
        print("Error: supabase-py not installed")
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
    
    boundaries = []
    for feature in data['features']:
        geom_type = feature['geometry']['type']
        if geom_type in ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']:
            geom = shape(feature['geometry'])
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
    """Determine which country's territorial waters a vessel is in"""
    point = Point(lon, lat)
    PROXIMITY_THRESHOLD = 0.2  # ~12 nautical miles
    
    for boundary in boundaries:
        geom_type = boundary['type']
        
        if geom_type in ['Polygon', 'MultiPolygon']:
            if boundary['geometry'].contains(point):
                return boundary['country']
        
        elif geom_type in ['LineString', 'MultiLineString']:
            distance = boundary['geometry'].distance(point)
            if distance < PROXIMITY_THRESHOLD:
                return boundary['country']
    
    return None

def analyze_all_history(supabase, boundaries):
    """Analyze ENTIRE database history to find boundary-crossing vessels"""
    
    print("Fetching ALL positions from database (with pagination)...")
    
    try:
        # Fetch ALL positions using pagination
        all_positions = []
        page_size = 1000
        offset = 0
        
        while True:
            response = supabase.table('vessel_positions')\
                .select('mmsi, longitude, latitude')\
                .order('mmsi')\
                .range(offset, offset + page_size - 1)\
                .execute()
            
            batch = response.data
            if not batch:
                break
            
            all_positions.extend(batch)
            offset += page_size
            print(f"  Fetched {len(all_positions)} positions so far...")
            
            if len(batch) < page_size:
                break
        
        positions = all_positions
        print(f"Total positions fetched: {len(positions)}")
        
    except Exception as e:
        print(f"Error fetching positions: {e}")
        return set(), set()
    
    # Group by MMSI
    vessels = {}
    for pos in positions:
        mmsi = pos['mmsi']
        if mmsi not in vessels:
            vessels[mmsi] = []
        vessels[mmsi].append(pos)
    
    print(f"Analyzing {len(vessels)} unique vessels...")
    
    # Analyze each vessel's complete history
    vessels_to_keep = set()
    vessels_to_delete = set()
    
    for i, (mmsi, positions) in enumerate(vessels.items(), 1):
        if i % 100 == 0:
            print(f"  Processed {i}/{len(vessels)} vessels...")
        
        # Track which countries visited
        countries_visited = set()
        for pos in positions:
            country = get_vessel_country(pos['longitude'], pos['latitude'], boundaries)
            if country:
                countries_visited.add(country)
        
        # Keep if crossed boundaries (visited multiple countries)
        if len(countries_visited) >= 2:
            vessels_to_keep.add(mmsi)
        else:
            vessels_to_delete.add(mmsi)
    
    print(f"\nAnalysis complete:")
    print(f"  - Vessels that crossed boundaries: {len(vessels_to_keep)}")
    print(f"  - Vessels to delete: {len(vessels_to_delete)}")
    
    return vessels_to_keep, vessels_to_delete

def delete_vessels_completely(supabase, mmsi_set):
    """Delete ALL positions for these vessels (entire history)"""
    if not mmsi_set:
        print("No vessels to delete")
        return
    
    mmsi_list = list(mmsi_set)
    
    try:
        batch_size = 100
        
        for i in range(0, len(mmsi_list), batch_size):
            batch = mmsi_list[i:i + batch_size]
            
            # Delete ALL records for these MMSIs (no timestamp filter)
            result = supabase.table('vessel_positions')\
                .delete()\
                .in_('mmsi', batch)\
                .execute()
            
            print(f"Deleted batch {i//batch_size + 1}/{(len(mmsi_list)-1)//batch_size + 1}")
        
        print(f"✓ Deleted ALL records for {len(mmsi_set)} vessels")
        
    except Exception as e:
        print(f"Error deleting vessels: {e}")
        raise

def main():
    print("=" * 60)
    print("FULL HISTORY CLEANUP - ONE TIME OPERATION")
    print("=" * 60)
    
    supabase = get_supabase_client()
    if not supabase:
        return
    
    boundaries = load_territorial_waters()
    if not boundaries:
        return
    
    # Analyze entire history
    vessels_to_keep, vessels_to_delete = analyze_all_history(supabase, boundaries)
    
    # Confirm before deletion
    if vessels_to_delete:
        print(f"\n⚠️  WARNING: About to delete {len(vessels_to_delete)} vessels completely!")
        print(f"This will free up ~{len(vessels_to_delete)/len(vessels_to_keep)*100:.1f}% of database space")
        response = input("\nProceed? (yes/no): ")
        
        if response.lower() == 'yes':
            print("\nDeleting vessels...")
            delete_vessels_completely(supabase, vessels_to_delete)
            print("\n✓ Full cleanup complete!")
        else:
            print("Cancelled.")
    else:
        print("\nNo vessels to delete - all have crossed boundaries!")
    
    print("=" * 60)

if __name__ == '__main__':
    main()
