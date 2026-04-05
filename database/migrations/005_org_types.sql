-- ADD ORGANISATION TYPES
-- Supports Companies, Municipalities, and Individuals

ALTER TABLE organisations 
ADD COLUMN org_type TEXT NOT NULL DEFAULT 'company';

-- Add check constraint for valid types
ALTER TABLE organisations 
ADD CONSTRAINT check_org_type 
CHECK (org_type IN ('company', 'municipality', 'individual'));

-- Update comment for clarity
COMMENT ON COLUMN organisations.org_type IS 'company | municipality | individual';

-- Add index for role-based filtering during super-user spotlight searches
CREATE INDEX idx_organisations_type ON organisations(org_type);
