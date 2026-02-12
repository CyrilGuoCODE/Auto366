-- Create admin_profiles table
CREATE TABLE IF NOT EXISTS public.admin_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

-- Enable Row Level Security
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for admin_profiles (only authenticated users can read their own profile)
CREATE POLICY "Admin profiles are viewable by authenticated users" ON public.admin_profiles
    FOR SELECT USING (auth.uid() = id);

-- Create policy for updating last_login
CREATE POLICY "Admin profiles can update their own last_login" ON public.admin_profiles
    FOR UPDATE USING (auth.uid() = id);

-- Create indexes
CREATE INDEX IF NOT EXISTS admin_profiles_email_idx ON public.admin_profiles(email);
CREATE INDEX IF NOT EXISTS admin_profiles_created_at_idx ON public.admin_profiles(created_at);

-- Insert a default admin user (you'll need to create this user in Supabase Auth first)
-- Replace with your actual admin email
-- INSERT INTO public.admin_profiles (id, email) 
-- VALUES ('your-user-uuid-here', 'admin@example.com');