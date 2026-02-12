import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useRulesetsStore = defineStore('rulesets', () => {
  // State
  const rulesets = ref([])
  const currentRuleset = ref(null)
  const loading = ref(false)
  const searchQuery = ref('')
  const sortBy = ref('latest') // 'latest', 'downloads', 'name'
  const filterStatus = ref('approved') // 'all', 'approved', 'pending'

  // Getters
  const filteredRulesets = computed(() => {
    let filtered = rulesets.value

    // Filter by status
    if (filterStatus.value !== 'all') {
      filtered = filtered.filter(ruleset => ruleset.status === filterStatus.value)
    }

    // Filter by search query
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      filtered = filtered.filter(ruleset => 
        ruleset.name.toLowerCase().includes(query) ||
        ruleset.description.toLowerCase().includes(query) ||
        ruleset.author.toLowerCase().includes(query)
      )
    }

    // Sort results
    switch (sortBy.value) {
      case 'downloads':
        return filtered.sort((a, b) => b.downloadCount - a.downloadCount)
      case 'name':
        return filtered.sort((a, b) => a.name.localeCompare(b.name))
      case 'latest':
      default:
        return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }
  })

  const pendingRulesets = computed(() => {
    return rulesets.value.filter(ruleset => ruleset.status === 'pending')
  })

  const approvedRulesets = computed(() => {
    return rulesets.value.filter(ruleset => ruleset.status === 'approved')
  })

  // Actions
  const setLoading = (loadingState) => {
    loading.value = loadingState
  }

  const setRulesets = (rulesetsData) => {
    rulesets.value = rulesetsData
  }

  const setCurrentRuleset = (ruleset) => {
    currentRuleset.value = ruleset
  }

  const setSearchQuery = (query) => {
    searchQuery.value = query
  }

  const setSortBy = (sort) => {
    sortBy.value = sort
  }

  const setFilterStatus = (status) => {
    filterStatus.value = status
  }

  const fetchRulesets = async () => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      const result = await DatabaseService.getRulesets({
        search: searchQuery.value,
        sortBy: sortBy.value,
        sortOrder: 'desc',
        limit: 50,
        offset: 0
      })
      
      if (result.error) {
        throw new Error(result.error.message || 'Failed to fetch rulesets')
      }
      
      // Transform database format to frontend format
      const transformedRulesets = (result.data || []).map(ruleset => ({
        id: ruleset.id,
        name: ruleset.name,
        description: ruleset.description,
        author: ruleset.author,
        status: ruleset.status,
        downloadCount: ruleset.download_count || 0,
        hasInjectionPackage: ruleset.has_injection_package || false,
        jsonFileSize: ruleset.json_file_size,
        zipFileSize: ruleset.zip_file_size,
        createdAt: ruleset.created_at,
        updatedAt: ruleset.updated_at,
        approvedAt: ruleset.approved_at,
        approvedBy: ruleset.approved_by
      }))
      
      setRulesets(transformedRulesets)
      return { success: true, data: transformedRulesets }
    } catch (error) {
      console.error('Fetch rulesets error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  const fetchRulesetById = async (id) => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      const result = await DatabaseService.getRulesetById(id)
      
      if (result.error) {
        throw new Error(result.error.message || 'Failed to fetch ruleset')
      }
      
      // Transform database format to frontend format
      const ruleset = result.data
      const detailedRuleset = {
        id: ruleset.id,
        name: ruleset.name,
        description: ruleset.description,
        author: ruleset.author,
        status: ruleset.status,
        downloadCount: ruleset.download_count || 0,
        hasInjectionPackage: ruleset.has_injection_package || false,
        jsonFileSize: ruleset.json_file_size,
        zipFileSize: ruleset.zip_file_size,
        createdAt: ruleset.created_at,
        updatedAt: ruleset.updated_at,
        approvedAt: ruleset.approved_at,
        approvedBy: ruleset.approved_by
      }
      
      setCurrentRuleset(detailedRuleset)
      return { success: true, data: detailedRuleset }
    } catch (error) {
      console.error('Fetch ruleset error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  const uploadRuleset = async (rulesetData, isAdminUpload = false) => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      console.log('Uploading ruleset:', rulesetData, 'Admin mode:', isAdminUpload)
      
      // Use DatabaseService for actual upload
      const result = await DatabaseService.createRuleset(rulesetData)
      
      if (result.error) {
        throw new Error(result.error.message || 'Upload failed')
      }
      
      // Transform database format to frontend format
      const ruleset = result.data
      const newRuleset = {
        id: ruleset.id,
        name: ruleset.name,
        description: ruleset.description,
        author: ruleset.author,
        status: ruleset.status || 'pending',
        downloadCount: ruleset.download_count || 0,
        hasInjectionPackage: ruleset.has_injection_package || false,
        jsonFileSize: ruleset.json_file_size,
        zipFileSize: ruleset.zip_file_size,
        createdAt: ruleset.created_at,
        updatedAt: ruleset.updated_at
      }
      
      rulesets.value.push(newRuleset)
      return { success: true, data: newRuleset }
    } catch (error) {
      console.error('Upload ruleset error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  const approveRuleset = async (id) => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      console.log('Approving ruleset:', id)
      
      const result = await DatabaseService.approveRuleset(id)
      
      if (result.error) {
        throw new Error(result.error.message || 'Approve failed')
      }
      
      // Update local state
      const ruleset = rulesets.value.find(r => r.id === id)
      if (ruleset) {
        ruleset.status = 'approved'
        ruleset.approvedAt = result.data.approved_at
        ruleset.approvedBy = result.data.approved_by
        ruleset.updatedAt = result.data.updated_at
      }
      
      return { success: true }
    } catch (error) {
      console.error('Approve ruleset error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  const rejectRuleset = async (id) => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      console.log('Rejecting ruleset:', id)
      
      const result = await DatabaseService.rejectRuleset(id)
      
      if (result.error) {
        throw new Error(result.error.message || 'Reject failed')
      }
      
      // Update local state
      const ruleset = rulesets.value.find(r => r.id === id)
      if (ruleset) {
        ruleset.status = 'rejected'
        ruleset.updatedAt = result.data.updated_at
      }
      
      return { success: true }
    } catch (error) {
      console.error('Reject ruleset error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  const deleteRuleset = async (id) => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      console.log('Deleting ruleset:', id)
      
      const result = await DatabaseService.deleteRuleset(id)
      
      if (result.error) {
        throw new Error(result.error.message || 'Delete failed')
      }
      
      // Remove from local state
      const index = rulesets.value.findIndex(r => r.id === id)
      if (index !== -1) {
        rulesets.value.splice(index, 1)
      }
      
      return { success: true }
    } catch (error) {
      console.error('Delete ruleset error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  const updateRuleset = async (id, updateData) => {
    setLoading(true)
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      console.log('Updating ruleset:', id, updateData)
      
      const result = await DatabaseService.updateRuleset(id, updateData)
      
      if (result.error) {
        throw new Error(result.error.message || 'Update failed')
      }
      
      // Update local state
      const ruleset = rulesets.value.find(r => r.id === id)
      if (ruleset) {
        Object.assign(ruleset, {
          jsonFileSize: result.data.json_file_size,
          zipFileSize: result.data.zip_file_size,
          hasInjectionPackage: result.data.has_injection_package,
          updatedAt: result.data.updated_at
        })
      }
      
      return { success: true, data: ruleset }
    } catch (error) {
      console.error('Update ruleset error:', error)
      return { success: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }

  return {
    // State
    rulesets,
    currentRuleset,
    loading,
    searchQuery,
    sortBy,
    filterStatus,
    
    // Getters
    filteredRulesets,
    pendingRulesets,
    approvedRulesets,
    
    // Actions
    setLoading,
    setRulesets,
    setCurrentRuleset,
    setSearchQuery,
    setSortBy,
    setFilterStatus,
    fetchRulesets,
    fetchRulesetById,
    uploadRuleset,
    approveRuleset,
    rejectRuleset,
    deleteRuleset,
    updateRuleset
  }
})