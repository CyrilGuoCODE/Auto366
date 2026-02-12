import { StorageService } from './storage.js'
import { DatabaseService } from './database.js'

/**
 * File Manager Service
 * Coordinates file operations with database updates
 * Ensures data consistency between storage and database
 */
export class FileManagerService {
  /**
   * Upload a complete ruleset (JSON + optional ZIP)
   * @param {Object} rulesetData - Ruleset metadata
   * @param {File} jsonFile - JSON rule file
   * @param {File} zipFile - Optional ZIP injection package
   * @param {boolean} isAdminUpload - Whether this is an admin upload
   * @returns {Promise<{success: boolean, ruleset: Object, error?: string}>}
   */
  static async uploadRuleset(rulesetData, jsonFile, zipFile = null, isAdminUpload = false) {
    try {
      // First create the ruleset record in database
      const { data: ruleset, error: dbError } = await DatabaseService.createRuleset({
        name: rulesetData.name,
        description: rulesetData.description,
        author: rulesetData.author,
        has_injection_package: !!zipFile
      })

      if (dbError || !ruleset) {
        throw new Error(`Database error: ${dbError?.message || 'Failed to create ruleset'}`)
      }

      const rulesetId = ruleset.id
      const uploadResults = {}

      try {
        // Upload JSON file
        const jsonResult = await StorageService.uploadJsonFile(rulesetId, jsonFile, {
          name: rulesetData.name,
          author: rulesetData.author,
          isAdminUpload: isAdminUpload.toString()
        })

        if (!jsonResult.success) {
          throw new Error(`JSON upload failed: ${jsonResult.error}`)
        }

        uploadResults.json = jsonResult

        // Upload ZIP file if provided
        if (zipFile) {
          const zipResult = await StorageService.uploadZipFile(rulesetId, zipFile, {
            name: rulesetData.name,
            author: rulesetData.author,
            isAdminUpload: isAdminUpload.toString()
          })

          if (!zipResult.success) {
            throw new Error(`ZIP upload failed: ${zipResult.error}`)
          }

          uploadResults.zip = zipResult
        }

        // Update database with file sizes
        const updateData = {
          json_file_size: uploadResults.json.size,
          zip_file_size: uploadResults.zip?.size || null
        }

        const { error: updateError } = await DatabaseService.updateRuleset(rulesetId, updateData)

        if (updateError) {
          console.warn('Failed to update file sizes in database:', updateError)
        }

        return {
          success: true,
          ruleset: {
            ...ruleset,
            ...updateData
          },
          uploadResults
        }

      } catch (uploadError) {
        // Cleanup: delete the database record if file upload failed
        await DatabaseService.deleteRuleset(rulesetId)
        throw uploadError
      }

    } catch (error) {
      console.error('Ruleset upload error:', error)
      return {
        success: false,
        ruleset: null,
        error: error.message
      }
    }
  }

  /**
   * Delete a complete ruleset (database record + files)
   * @param {string} rulesetId - Ruleset ID
   * @returns {Promise<{success: boolean, results: Object, error?: string}>}
   */
  static async deleteRuleset(rulesetId) {
    try {
      // Delete files from storage
      const storageResult = await StorageService.deleteRulesetFiles(rulesetId)

      // Delete database record
      const { error: dbError } = await DatabaseService.deleteRuleset(rulesetId)

      return {
        success: storageResult.success && !dbError,
        results: {
          storage: storageResult,
          database: { success: !dbError, error: dbError?.message }
        },
        error: dbError?.message
      }

    } catch (error) {
      console.error('Ruleset deletion error:', error)
      return {
        success: false,
        results: null,
        error: error.message
      }
    }
  }

  /**
   * Get download URLs for a ruleset
   * @param {string} rulesetId - Ruleset ID
   * @param {boolean} incrementCount - Whether to increment download count
   * @returns {Promise<{success: boolean, urls: Object, error?: string}>}
   */
  static async getRulesetDownloadUrls(rulesetId, incrementCount = true) {
    try {
      // Verify ruleset exists and is approved
      const { data: ruleset, error: dbError } = await DatabaseService.getRulesetById(rulesetId)

      if (dbError || !ruleset) {
        throw new Error('Ruleset not found or not approved')
      }

      // Get download URLs
      const [jsonResult, zipResult] = await Promise.allSettled([
        StorageService.getJsonDownloadUrl(rulesetId),
        ruleset.has_injection_package ? StorageService.getZipDownloadUrl(rulesetId) : Promise.resolve({ success: false })
      ])

      const urls = {}

      if (jsonResult.status === 'fulfilled' && jsonResult.value.success) {
        urls.json = jsonResult.value.url
      }

      if (zipResult.status === 'fulfilled' && zipResult.value.success) {
        urls.zip = zipResult.value.url
      }

      // Increment download count if requested
      if (incrementCount && Object.keys(urls).length > 0) {
        await DatabaseService.incrementDownloadCount(rulesetId)
      }

      return {
        success: Object.keys(urls).length > 0,
        urls,
        ruleset
      }

    } catch (error) {
      console.error('Download URL generation error:', error)
      return {
        success: false,
        urls: {},
        error: error.message
      }
    }
  }

  /**
   * Update ruleset files (admin operation)
   * @param {string} rulesetId - Ruleset ID
   * @param {File} jsonFile - New JSON file (optional)
   * @param {File} zipFile - New ZIP file (optional)
   * @param {boolean} isAdminUpload - Whether this is an admin upload
   * @returns {Promise<{success: boolean, results: Object, error?: string}>}
   */
  static async updateRulesetFiles(rulesetId, jsonFile = null, zipFile = null, isAdminUpload = true) {
    try {
      const results = {}

      // Update JSON file if provided
      if (jsonFile) {
        const jsonResult = await StorageService.uploadJsonFile(rulesetId, jsonFile, {
          isAdminUpload: isAdminUpload.toString(),
          updatedAt: new Date().toISOString()
        })
        results.json = jsonResult

        if (jsonResult.success) {
          // Update database with new file size
          await DatabaseService.updateRuleset(rulesetId, {
            json_file_size: jsonResult.size
          })
        }
      }

      // Update ZIP file if provided
      if (zipFile) {
        const zipResult = await StorageService.uploadZipFile(rulesetId, zipFile, {
          isAdminUpload: isAdminUpload.toString(),
          updatedAt: new Date().toISOString()
        })
        results.zip = zipResult

        if (zipResult.success) {
          // Update database with new file size and injection package flag
          await DatabaseService.updateRuleset(rulesetId, {
            zip_file_size: zipResult.size,
            has_injection_package: true
          })
        }
      }

      const success = Object.values(results).every(result => result.success)

      return {
        success,
        results
      }

    } catch (error) {
      console.error('File update error:', error)
      return {
        success: false,
        results: {},
        error: error.message
      }
    }
  }

  /**
   * Validate file before upload
   * @param {File} file - File to validate
   * @param {string} expectedType - Expected file type ('json' or 'zip')
   * @param {boolean} isAdminUpload - Whether this is an admin upload (less strict validation)
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  static async validateFile(file, expectedType, isAdminUpload = false) {
    try {
      // For admin uploads, skip size and content validation
      if (!isAdminUpload) {
        // Check file size (10MB limit for regular users)
        const maxSize = 10 * 1024 * 1024
        if (file.size > maxSize) {
          return {
            valid: false,
            error: 'File size exceeds 10MB limit'
          }
        }
      }

      // Basic file type check (always performed)
      if (expectedType === 'json') {
        if (!file.type.includes('json') && !file.name.endsWith('.json')) {
          return {
            valid: false,
            error: 'File must be a JSON file'
          }
        }

        // Skip JSON structure validation for admin uploads
        if (!isAdminUpload) {
          // Validate JSON structure for regular users
          try {
            const content = await file.text()
            const parsed = JSON.parse(content)
            
            // Basic validation for Auto366 ruleset structure
            if (!parsed.name || !parsed.rules || !Array.isArray(parsed.rules)) {
              return {
                valid: false,
                error: 'Invalid JSON structure. Must contain name and rules array'
              }
            }
          } catch (jsonError) {
            return {
              valid: false,
              error: 'Invalid JSON format'
            }
          }
        }
      }

      if (expectedType === 'zip') {
        if (!file.type.includes('zip') && !file.name.endsWith('.zip')) {
          return {
            valid: false,
            error: 'File must be a ZIP file'
          }
        }
      }

      return { valid: true }

    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${error.message}`
      }
    }
  }

  /**
   * Get file information for a ruleset
   * @param {string} rulesetId - Ruleset ID
   * @returns {Promise<{success: boolean, info: Object, error?: string}>}
   */
  static async getRulesetFileInfo(rulesetId) {
    try {
      const fileExists = await StorageService.checkFilesExist(rulesetId)
      
      const info = {
        json: {
          exists: fileExists.json,
          metadata: null
        },
        zip: {
          exists: fileExists.zip,
          metadata: null
        }
      }

      // Get detailed metadata for existing files
      if (fileExists.json) {
        const jsonMeta = await StorageService.getFileMetadata(rulesetId, 'json')
        if (jsonMeta.success) {
          info.json.metadata = jsonMeta.metadata
        }
      }

      if (fileExists.zip) {
        const zipMeta = await StorageService.getFileMetadata(rulesetId, 'zip')
        if (zipMeta.success) {
          info.zip.metadata = zipMeta.metadata
        }
      }

      return {
        success: true,
        info
      }

    } catch (error) {
      console.error('File info error:', error)
      return {
        success: false,
        info: null,
        error: error.message
      }
    }
  }
}