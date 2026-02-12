import { supabase, auth } from '../lib/supabase.js'
import { Tables } from '../types/database.js'

/**
 * Authentication service for Auto366
 * Handles admin authentication and session management via API endpoints
 */
export class AuthService {
  /**
   * Sign in admin user with email and password
   * @param {string} email - Admin email
   * @param {string} password - Admin password
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async signIn(email, password) {
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      // Set the session in Supabase client for subsequent requests
      if (result.data.session) {
        await supabase.auth.setSession(result.data.session)
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Sign in error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Sign out current user
   * @returns {Promise<{error: any}>}
   */
  static async signOut() {
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST'
      })

      const result = await response.json()

      if (!response.ok) {
        return { error: result }
      }

      // Clear the session in Supabase client
      await supabase.auth.signOut()

      return { error: null }
    } catch (error) {
      console.error('Sign out error:', error)
      return { error: error.message }
    }
  }

  /**
   * Get current session
   * @returns {Promise<{data: Object, error: any}>}
   */
  static async getSession() {
    return await auth.getSession()
  }

  /**
   * Get current user
   * @returns {Promise<{data: Object, error: any}>}
   */
  static async getUser() {
    return await auth.getUser()
  }

  /**
   * Check if current user is authenticated
   * @returns {Promise<boolean>}
   */
  static async isAuthenticated() {
    try {
      const { data: { session } } = await this.getSession()
      
      if (!session) {
        return false
      }

      // Verify with API
      const response = await fetch('/api/admin/verify', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      return response.ok
    } catch (error) {
      console.error('Authentication check error:', error)
      return false
    }
  }

  /**
   * Listen to authentication state changes
   * @param {Function} callback - Callback function to handle auth state changes
   * @returns {Function} Unsubscribe function
   */
  static onAuthStateChange(callback) {
    const { data: { subscription } } = auth.onAuthStateChange(callback)
    return () => subscription.unsubscribe()
  }

  /**
   * Update admin profile last login timestamp
   * @param {string} userId - User ID
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async updateLastLogin(userId) {
    return await supabase
      .from(Tables.ADMIN_PROFILES)
      .upsert({
        id: userId,
        last_login: new Date().toISOString()
      }, {
        onConflict: 'id'
      })
  }

  /**
   * Get admin profile for current user
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async getAdminProfile() {
    const { data: { user } } = await this.getUser()
    
    if (!user) {
      return { data: null, error: new Error('No authenticated user') }
    }

    return await supabase
      .from(Tables.ADMIN_PROFILES)
      .select('*')
      .eq('id', user.id)
      .single()
  }

  /**
   * Create admin profile for new user
   * @param {string} userId - User ID
   * @param {string} email - User email
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async createAdminProfile(userId, email) {
    return await supabase
      .from(Tables.ADMIN_PROFILES)
      .insert({
        id: userId,
        email,
        created_at: new Date().toISOString()
      })
      .select()
      .single()
  }
}