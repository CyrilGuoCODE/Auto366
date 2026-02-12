-- Create rulesets table
CREATE TABLE IF NOT EXISTS public.rulesets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    json_file_size INTEGER NOT NULL,
    zip_file_size INTEGER,
    has_injection_package BOOLEAN DEFAULT FALSE,
    download_count INTEGER DEFAULT 0,
    json_file_url TEXT,
    zip_file_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES public.admin_profiles(id)
);

-- Enable Row Level Security
ALTER TABLE public.rulesets ENABLE ROW LEVEL SECURITY;

-- Create policies for rulesets
-- Anyone can view approved rulesets
CREATE POLICY "Approved rulesets are viewable by everyone" ON public.rulesets
    FOR SELECT USING (status = 'approved');

-- Only authenticated admin users can view all rulesets
CREATE POLICY "All rulesets are viewable by admin users" ON public.rulesets
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.admin_profiles 
            WHERE id = auth.uid()
        )
    );

-- Only authenticated admin users can insert rulesets
CREATE POLICY "Admin users can insert rulesets" ON public.rulesets
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.admin_profiles 
            WHERE id = auth.uid()
        )
    );

-- Only authenticated admin users can update rulesets
CREATE POLICY "Admin users can update rulesets" ON public.rulesets
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.admin_profiles 
            WHERE id = auth.uid()
        )
    );

-- Only authenticated admin users can delete rulesets
CREATE POLICY "Admin users can delete rulesets" ON public.rulesets
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.admin_profiles 
            WHERE id = auth.uid()
        )
    );

-- Create indexes
CREATE INDEX IF NOT EXISTS rulesets_status_idx ON public.rulesets(status);
CREATE INDEX IF NOT EXISTS rulesets_created_at_idx ON public.rulesets(created_at);
CREATE INDEX IF NOT EXISTS rulesets_download_count_idx ON public.rulesets(download_count);
CREATE INDEX IF NOT EXISTS rulesets_approved_by_idx ON public.rulesets(approved_by);

-- Create function to increment download count
CREATE OR REPLACE FUNCTION increment_download_count(ruleset_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.rulesets 
    SET download_count = download_count + 1,
        updated_at = NOW()
    WHERE id = ruleset_id AND status = 'approved';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_rulesets_updated_at
    BEFORE UPDATE ON public.rulesets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();