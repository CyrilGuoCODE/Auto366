import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// Create Supabase client with TypeScript support
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// Auth helper functions
export const auth = {
  // Sign in admin user
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) throw error
    
    // Update last login timestamp
    if (data.user) {
      await supabase.rpc('update_admin_last_login')
    }
    
    return data
  },

  // Sign out user
  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  // Get current session
  async getSession() {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error
    return session
  },

  // Get current user
  async getUser() {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) throw error
    return user
  },

  // Check if user is admin
  async isAdmin() {
    const user = await this.getUser()
    if (!user) return false

    const { data, error } = await supabase
      .from('admin_profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    return !error && !!data
  },

  // Listen to auth state changes
  onAuthStateChange(callback: (event: string, session: any) => void) {
    return supabase.auth.onAuthStateChange(callback)
  }
}

// Database helper functions
export const db = {
  // Ruleset operations
  rulesets: {
    // Get approved rulesets with pagination and filters
    async getApproved(params: {
      page?: number
      pageSize?: number
      search?: string
      author?: string
      sortBy?: 'created_at' | 'download_count' | 'name'
      sortOrder?: 'asc' | 'desc'
    } = {}) {
      const {
        page = 1,
        pageSize = 20,
        search,
        author,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = params

      let query = supabase
        .from('rulesets')
        .select('*', { count: 'exact' })
        .eq('status', 'approved')

      // Apply filters
      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
      }
      if (author) {
        query = query.eq('author', author)
      }

      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === 'asc' })

      // Apply pagination
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, error, count } = await query

      if (error) throw error

      return {
        data: data || [],
        count: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize)
      }
    },

    // Get single ruleset by ID
    async getById(id: string) {
      const { data, error } = await supabase
        .from('rulesets')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    },

    // Create new ruleset
    async create(ruleset: {
      name: string
      description?: string
      author: string
      json_file_size?: number
      zip_file_size?: number
      has_injection_package?: boolean
    }) {
      const { data, error } = await supabase
        .from('rulesets')
        .insert(ruleset)
        .select()
        .single()

      if (error) throw error
      return data
    },

    // Increment download count
    async incrementDownloadCount(id: string) {
      const { error } = await supabase.rpc('increment_download_count', {
        ruleset_id: id
      })
      if (error) throw error
    }
  },

  // Admin operations
  admin: {
    // Get all rulesets (admin only)
    async getAllRulesets(status?: 'pending' | 'approved' | 'rejected') {
      let query = supabase
        .from('rulesets')
        .select('*')
        .order('created_at', { ascending: false })

      if (status) {
        query = query.eq('status', status)
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },

    // Get pending rulesets
    async getPendingRulesets() {
      return this.getAllRulesets('pending')
    },

    // Approve ruleset
    async approveRuleset(id: string) {
      const { error } = await supabase.rpc('approve_ruleset', {
        ruleset_id: id
      })
      if (error) throw error
    },

    // Reject ruleset
    async rejectRuleset(id: string) {
      const { error } = await supabase.rpc('reject_ruleset', {
        ruleset_id: id
      })
      if (error) throw error
    },

    // Delete ruleset
    async deleteRuleset(id: string) {
      const { error } = await supabase
        .from('rulesets')
        .delete()
        .eq('id', id)
      if (error) throw error
    },

    // Update ruleset
    async updateRuleset(id: string, updates: Partial<{
      name: string
      description: string
      author: string
      json_file_size: number
      zip_file_size: number
      has_injection_package: boolean
    }>) {
      const { data, error } = await supabase
        .from('rulesets')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    }
  }
}