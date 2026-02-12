import { supabase } from '../lib/supabase.js'
import { Tables, RulesetStatus } from '../types/database.js'
import { config } from '../config/index.js'

/**
 * Database service for Auto366
 * Provides methods for interacting with Supabase database via API endpoints
 */
export class DatabaseService {
  /**
   * Get all approved rulesets with optional filtering and pagination
   * @param {Object} options - Query options
   * @param {string} options.search - Search term for name, author, or description
   * @param {string} options.sortBy - Sort field (name, created_at, download_count)
   * @param {string} options.sortOrder - Sort order (asc, desc)
   * @param {number} options.limit - Number of results to return
   * @param {number} options.offset - Number of results to skip
   * @returns {Promise<{data: Array, count: number, error: any}>}
   */
  static async getRulesets(options = {}) {
    const {
      search = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
      limit = 20,
      offset = 0
    } = options

    try {
      const params = new URLSearchParams({
        search,
        sortBy,
        sortOrder,
        limit: limit.toString(),
        offset: offset.toString()
      })

      const response = await fetch(`${config.api.baseUrl}/rulesets?${params}`)
      const result = await response.json()

      if (!response.ok) {
        return { data: [], count: 0, error: result }
      }

      return {
        data: result.data || [],
        count: result.count || 0,
        error: null
      }
    } catch (error) {
      console.error('Get rulesets error:', error)
      return { data: [], count: 0, error: error.message }
    }
  }

  /**
   * Get a specific ruleset by ID
   * @param {string} id - Ruleset ID
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async getRulesetById(id) {
    try {
      const response = await fetch(`${config.api.baseUrl}/rulesets/${id}`)
      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Get ruleset by ID error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Create a new ruleset (pending approval)
   * @param {Object} rulesetData - Ruleset data with files
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async createRuleset(rulesetData) {
    try {
      const formData = new FormData()
      formData.append('name', rulesetData.name)
      formData.append('description', rulesetData.description)
      formData.append('author', rulesetData.author)
      formData.append('json', rulesetData.jsonFile)
      
      if (rulesetData.zipFile) {
        formData.append('zip', rulesetData.zipFile)
      }

      const response = await fetch(`${config.api.baseUrl}/rulesets`, {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Create ruleset error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Increment download count for a ruleset
   * @param {string} id - Ruleset ID
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async incrementDownloadCount(id) {
    // This is handled automatically by the download endpoint
    return { data: { success: true }, error: null }
  }

  /**
   * Get all rulesets for admin (including all statuses)
   * @param {string} status - Status filter ('all', 'pending', 'approved', 'rejected')
   * @returns {Promise<{data: Array, error: any}>}
   */
  static async getAllRulesetsForAdmin(status = 'all') {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return { data: [], error: 'Authentication required' }
      }

      const params = new URLSearchParams()
      if (status !== 'all') {
        params.append('status', status)
      }

      const response = await fetch(`${config.api.baseUrl}/admin/rulesets?${params}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: [], error: result }
      }

      return { data: result.data || [], error: null }
    } catch (error) {
      console.error('Get all rulesets for admin error:', error)
      return { data: [], error: error.message }
    }
  }

  /**
   * Get pending rulesets for admin review
   * @returns {Promise<{data: Array, error: any}>}
   */
  static async getPendingRulesets() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return { data: [], error: 'Authentication required' }
      }

      const response = await fetch(`${config.api.baseUrl}/admin/rulesets?status=pending`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: [], error: result }
      }

      return { data: result.data || [], error: null }
    } catch (error) {
      console.error('Get pending rulesets error:', error)
      return { data: [], error: error.message }
    }
  }

  /**
   * Approve a ruleset
   * @param {string} id - Ruleset ID
   * @param {string} adminId - Admin user ID (optional, handled by API)
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async approveRuleset(id, adminId) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return { data: null, error: 'Authentication required' }
      }

      const response = await fetch(`${config.api.baseUrl}/admin/rulesets/${id}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Approve ruleset error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Reject a ruleset
   * @param {string} id - Ruleset ID
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async rejectRuleset(id) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return { data: null, error: 'Authentication required' }
      }

      const response = await fetch(`${config.api.baseUrl}/admin/rulesets/${id}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Reject ruleset error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Delete a ruleset
   * @param {string} id - Ruleset ID
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async deleteRuleset(id) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return { data: null, error: 'Authentication required' }
      }

      const response = await fetch(`${config.api.baseUrl}/admin/rulesets/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Delete ruleset error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Update ruleset metadata
   * @param {string} id - Ruleset ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async updateRuleset(id, updates) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        return { data: null, error: 'Authentication required' }
      }

      const formData = new FormData()
      
      if (updates.jsonFile) {
        formData.append('json', updates.jsonFile)
      }
      
      if (updates.zipFile) {
        formData.append('zip', updates.zipFile)
      }

      const response = await fetch(`${config.api.baseUrl}/admin/rulesets/${id}/files`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        },
        body: formData
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Update ruleset error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Get download URL for a ruleset file
   * @param {string} id - Ruleset ID
   * @param {string} fileType - File type ('json' or 'zip')
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async getDownloadUrl(id, fileType) {
    try {
      const response = await fetch(`${config.api.baseUrl}/rulesets/${id}/download?type=${fileType}`)
      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result, error: null }
    } catch (error) {
      console.error('Get download URL error:', error)
      return { data: null, error: error.message }
    }
  }

  /**
   * Parse answer file
   * @param {File} file - Answer file to parse
   * @returns {Promise<{data: Object|null, error: any}>}
   */
  static async parseAnswerFile(file) {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${config.api.baseUrl}/answers/parse`, {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (!response.ok) {
        return { data: null, error: result }
      }

      return { data: result.data, error: null }
    } catch (error) {
      console.error('Parse answer file error:', error)
      return { data: null, error: error.message }
    }
  }
}