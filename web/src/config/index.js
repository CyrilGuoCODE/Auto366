// Application configuration
export const config = {
  // Supabase configuration
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
  },
  
  // API configuration
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || '/api'
  },
  
  // S3 Storage configuration
  storage: {
    endpoint: import.meta.env.S3_ENDPOINT,
    accessKey: import.meta.env.S3_ACCESS_KEY,
    secretKey: import.meta.env.S3_SECRET_KEY,
    bucket: import.meta.env.S3_BUCKET || 'auto366-rulesets',
    region: import.meta.env.S3_REGION || 'auto'
  },
  
  // Application settings
  app: {
    name: 'Auto366',
    version: '1.0.0',
    environment: import.meta.env.MODE || 'development'
  },
  
  // File upload settings
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB for regular users
    maxAdminFileSize: 100 * 1024 * 1024, // 100MB for admin uploads
    allowedJsonTypes: ['application/json', 'text/json'],
    allowedZipTypes: ['application/zip', 'application/x-zip-compressed']
  }
}

// Validate required configuration
export const validateConfig = () => {
  const errors = []
  
  if (!config.supabase.url) {
    errors.push('VITE_SUPABASE_URL is required')
  }
  
  if (!config.supabase.anonKey) {
    errors.push('VITE_SUPABASE_ANON_KEY is required')
  }
  
  // S3 configuration is optional for development
  if (config.app.environment === 'production') {
    if (!config.storage.endpoint) {
      errors.push('S3_ENDPOINT is required in production')
    }
    
    if (!config.storage.accessKey) {
      errors.push('S3_ACCESS_KEY is required in production')
    }
    
    if (!config.storage.secretKey) {
      errors.push('S3_SECRET_KEY is required in production')
    }
  }
  
  if (errors.length > 0) {
    console.warn(`Configuration warnings: ${errors.join(', ')}`)
    // Don't throw error, just warn
  }
}

// Export individual config sections for convenience
export const { supabase: supabaseConfig, api: apiConfig, app: appConfig, upload: uploadConfig, storage: storageConfig } = config