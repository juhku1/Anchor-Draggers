-- Add territorial_water_country_code column and index
ALTER TABLE public.vessel_positions
  ADD COLUMN IF NOT EXISTS territorial_water_country_code CHAR(2);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS vessel_positions_territorial_water_country_code_idx
  ON public.vessel_positions (territorial_water_country_code);
