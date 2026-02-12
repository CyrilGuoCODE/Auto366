// Export all services
export { DatabaseService } from './database.js'
export { AuthService } from './auth.js'

// S3 services - these will be null if S3 is not configured
export { StorageService } from './storage.js'
export { FileManagerService } from './fileManager.js'

// Re-export Supabase client for direct access when needed
export { supabase, auth } from '../lib/supabase.js'