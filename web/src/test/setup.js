// Test setup file for vitest
import { vi } from 'vitest'

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  },
  writable: true
})

// Mock environment variables for tests
vi.mock('../config/index.js', () => ({
  config: {
    supabase: {
      url: 'https://test.supabase.co',
      anonKey: 'test-anon-key'
    },
    api: {
      baseUrl: '/api'
    },
    app: {
      name: 'Auto366',
      version: '1.0.0',
      environment: 'test'
    },
    upload: {
      maxFileSize: 10 * 1024 * 1024,
      allowedJsonTypes: ['application/json', 'text/json'],
      allowedZipTypes: ['application/zip', 'application/x-zip-compressed']
    }
  },
  supabaseConfig: {
    url: 'https://test.supabase.co',
    anonKey: 'test-anon-key'
  },
  validateConfig: vi.fn()
}))

// Global test utilities
global.console = {
  ...console,
  // Suppress console.error in tests unless needed
  error: vi.fn()
}