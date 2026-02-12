import { createClient } from '@supabase/supabase-js'
import { supabaseConfig, validateConfig } from '../config/index.js'

// Validate configuration on import
validateConfig()

const { url: supabaseUrl, anonKey: supabaseAnonKey } = supabaseConfig

// Create and configure Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Configure authentication settings
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Set storage to localStorage for web
    storage: window.localStorage
  },
  // Configure database settings
  db: {
    schema: 'public'
  },
  // Configure realtime settings (disabled for now as not needed)
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// Export auth helpers for convenience
export const auth = supabase.auth
export const db = supabase

// Helper function to check if user is authenticated
export const isAuthenticated = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}

// Helper function to get current user
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Helper function to sign out
export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('Error signing out:', error)
    throw error
  }
}