-- Create companies table for enrichment data
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- User input
    company_name TEXT NOT NULL,
    website TEXT,

    -- Enriched data stored as flexible JSON
    -- This allows adding new fields without schema migrations
    enriched_data JSONB DEFAULT '{}',

    -- Enrichment tracking
    enrichment_status TEXT DEFAULT 'pending'
        CHECK (enrichment_status IN ('pending', 'processing', 'completed', 'failed')),
    enrichment_error TEXT,
    enriched_at TIMESTAMPTZ,

    -- Parallel API run ID for tracking/polling
    parallel_run_id TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable real-time subscriptions for this table
-- This allows the frontend to receive instant updates
ALTER PUBLICATION supabase_realtime ADD TABLE companies;
