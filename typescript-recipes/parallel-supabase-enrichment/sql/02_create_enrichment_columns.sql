-- OPTIONAL: Dynamic enrichment column configuration
-- Use this if you want to define enrichment fields in the database
-- rather than hardcoding them in the Edge Function

CREATE TABLE IF NOT EXISTS enrichment_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Column metadata
    name TEXT NOT NULL UNIQUE,          -- JSON key, e.g., "ceo_name"
    display_name TEXT NOT NULL,          -- UI label, e.g., "CEO Name"
    column_type TEXT NOT NULL CHECK (column_type IN ('text', 'number', 'enum')),
    description TEXT NOT NULL,           -- Instructions for Parallel API
    enum_values TEXT[],                  -- Options for enum type
    sort_order INT DEFAULT 0             -- Display order in UI
);

-- Index for sorting
CREATE INDEX IF NOT EXISTS idx_enrichment_columns_sort ON enrichment_columns(sort_order);

-- Enable real-time for column config changes
ALTER PUBLICATION supabase_realtime ADD TABLE enrichment_columns;

-- Seed with default columns
INSERT INTO enrichment_columns (name, display_name, column_type, description, enum_values, sort_order) VALUES
    ('industry', 'Industry', 'text',
     'Primary industry the company operates in.',
     NULL, 1),

    ('employee_count', 'Employees', 'enum',
     'Approximate number of employees.',
     ARRAY['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+', 'Unknown'], 2),

    ('headquarters', 'Headquarters', 'text',
     'Headquarters location in "City, Country" format.',
     NULL, 3),

    ('founded_year', 'Founded', 'text',
     'Year the company was founded (YYYY format). Return null if not found.',
     NULL, 4),

    ('funding_stage', 'Funding Stage', 'text',
     'Latest funding stage (e.g., Seed, Series A, Series B, Public, Bootstrapped).',
     NULL, 5),

    ('total_funding', 'Total Funding', 'text',
     'Total funding raised (e.g., "$50M", "$1.2B"). Return null if unknown or bootstrapped.',
     NULL, 6),

    ('description', 'Description', 'text',
     'A 1-2 sentence description of what the company does and its main product/service.',
     NULL, 7)
ON CONFLICT (name) DO NOTHING;
