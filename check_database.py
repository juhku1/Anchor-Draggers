#!/usr/bin/env python3
"""Quick check: How many rows are actually in the database?"""

import os

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://baeebralrmgccruigyle.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')

def main():
    from supabase import create_client
    
    print(f"Connecting to: {SUPABASE_URL}")
    print(f"Using key: {SUPABASE_KEY[:20]}..." if SUPABASE_KEY else "NO KEY SET!")
    
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Count total rows
    response = supabase.table('vessel_positions').select('*', count='exact').limit(1).execute()
    total_count = response.count
    
    print(f"\nTotal rows in vessel_positions: {total_count}")
    
    # Count unique vessels
    response = supabase.table('vessel_positions').select('mmsi').execute()
    unique_mmsi = set(row['mmsi'] for row in response.data)
    print(f"Unique MMSIs (first 1000): {len(unique_mmsi)}")
    
    # Get timestamp range
    response = supabase.table('vessel_positions')\
        .select('timestamp')\
        .order('timestamp', desc=False)\
        .limit(1)\
        .execute()
    
    if response.data:
        print(f"Oldest record: {response.data[0]['timestamp']}")
    
    response = supabase.table('vessel_positions')\
        .select('timestamp')\
        .order('timestamp', desc=True)\
        .limit(1)\
        .execute()
    
    if response.data:
        print(f"Newest record: {response.data[0]['timestamp']}")

if __name__ == '__main__':
    main()
