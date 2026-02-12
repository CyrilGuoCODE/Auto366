import { 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand, 
  HeadObjectCommand 
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client, S3_CONFIG } from '../lib/s3.js'

/**
 * S3-compatible storage service for Auto366
 * Handles file upload, download, and deletion operations
 */
export class StorageService {
  /**
   * Get S3 client with error handling
   * @returns {S3Client|null} - S3 client or null if not configured
   */
  static getClient() {
    const client = getS3Client()
    if (!client) {
      console.warn('S3 client not configured. S3 operations will fail.')
    }
    return client
  }
  /**
   * Upload a JSON rule file to S3
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @param {File|Buffer|string} fileContent - File content to upload
   * @param {Object} metadata - Optional metadata for the file
   * @returns {Promise<{success: boolean, key: string, size: number, error?: string}>}
   */
  static async uploadJsonFile(rulesetId, fileContent, metadata = {}) {
    try {
      const s3Client = this.getClient()
      if (!s3Client) {
        return {
          success: false,
          key: null,
          size: 0,
          error: 'S3 client not configured'
        }
      }

      const key = `${S3_CONFIG.paths.json}${rulesetId}.json`
      
      // Convert File to Buffer if needed
      let content = fileContent
      if (fileContent instanceof File) {
        content = await fileContent.arrayBuffer()
      }
      
      const command = new PutObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
        Body: content,
        ContentType: 'application/json',
        Metadata: {
          rulesetId,
          uploadedAt: new Date().toISOString(),
          ...metadata
        }
      })

      await s3Client.send(command)
      
      // Get file size
      const size = content.byteLength || content.length || 0
      
      return {
        success: true,
        key,
        size
      }
    } catch (error) {
      console.error('Error uploading JSON file:', error)
      return {
        success: false,
        key: null,
        size: 0,
        error: error.message
      }
    }
  }

  /**
   * Upload a ZIP injection package to S3
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @param {File|Buffer} fileContent - File content to upload
   * @param {Object} metadata - Optional metadata for the file
   * @returns {Promise<{success: boolean, key: string, size: number, error?: string}>}
   */
  static async uploadZipFile(rulesetId, fileContent, metadata = {}) {
    try {
      const key = `${S3_CONFIG.paths.zip}${rulesetId}.zip`
      
      // Convert File to Buffer if needed
      let content = fileContent
      if (fileContent instanceof File) {
        content = await fileContent.arrayBuffer()
      }
      
      const command = new PutObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
        Body: content,
        ContentType: 'application/zip',
        Metadata: {
          rulesetId,
          uploadedAt: new Date().toISOString(),
          ...metadata
        }
      })

      await s3Client.send(command)
      
      // Get file size
      const size = content.byteLength || content.length || 0
      
      return {
        success: true,
        key,
        size
      }
    } catch (error) {
      console.error('Error uploading ZIP file:', error)
      return {
        success: false,
        key: null,
        size: 0,
        error: error.message
      }
    }
  }

  /**
   * Generate a signed download URL for a JSON file
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @param {number} expiresIn - URL expiration time in seconds (default: 1 hour)
   * @returns {Promise<{success: boolean, url: string, error?: string}>}
   */
  static async getJsonDownloadUrl(rulesetId, expiresIn = 3600) {
    try {
      const key = `${S3_CONFIG.paths.json}${rulesetId}.json`
      
      // Check if file exists
      const headCommand = new HeadObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      await s3Client.send(headCommand)
      
      // Generate signed URL
      const getCommand = new GetObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      const url = await getSignedUrl(s3Client, getCommand, { expiresIn })
      
      return {
        success: true,
        url
      }
    } catch (error) {
      console.error('Error generating JSON download URL:', error)
      return {
        success: false,
        url: null,
        error: error.message
      }
    }
  }

  /**
   * Generate a signed download URL for a ZIP file
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @param {number} expiresIn - URL expiration time in seconds (default: 1 hour)
   * @returns {Promise<{success: boolean, url: string, error?: string}>}
   */
  static async getZipDownloadUrl(rulesetId, expiresIn = 3600) {
    try {
      const key = `${S3_CONFIG.paths.zip}${rulesetId}.zip`
      
      // Check if file exists
      const headCommand = new HeadObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      await s3Client.send(headCommand)
      
      // Generate signed URL
      const getCommand = new GetObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      const url = await getSignedUrl(s3Client, getCommand, { expiresIn })
      
      return {
        success: true,
        url
      }
    } catch (error) {
      console.error('Error generating ZIP download URL:', error)
      return {
        success: false,
        url: null,
        error: error.message
      }
    }
  }

  /**
   * Delete JSON file from S3
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async deleteJsonFile(rulesetId) {
    try {
      const key = `${S3_CONFIG.paths.json}${rulesetId}.json`
      
      const command = new DeleteObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      await s3Client.send(command)
      
      return {
        success: true
      }
    } catch (error) {
      console.error('Error deleting JSON file:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Delete ZIP file from S3
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async deleteZipFile(rulesetId) {
    try {
      const key = `${S3_CONFIG.paths.zip}${rulesetId}.zip`
      
      const command = new DeleteObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      await s3Client.send(command)
      
      return {
        success: true
      }
    } catch (error) {
      console.error('Error deleting ZIP file:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Delete both JSON and ZIP files for a ruleset
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @returns {Promise<{success: boolean, results: Object, error?: string}>}
   */
  static async deleteRulesetFiles(rulesetId) {
    try {
      const [jsonResult, zipResult] = await Promise.allSettled([
        this.deleteJsonFile(rulesetId),
        this.deleteZipFile(rulesetId)
      ])
      
      const results = {
        json: jsonResult.status === 'fulfilled' ? jsonResult.value : { success: false, error: jsonResult.reason?.message },
        zip: zipResult.status === 'fulfilled' ? zipResult.value : { success: false, error: zipResult.reason?.message }
      }
      
      // Consider successful if at least one file was deleted or both operations completed
      const success = results.json.success || results.zip.success
      
      return {
        success,
        results
      }
    } catch (error) {
      console.error('Error deleting ruleset files:', error)
      return {
        success: false,
        results: null,
        error: error.message
      }
    }
  }

  /**
   * Check if files exist for a ruleset
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @returns {Promise<{json: boolean, zip: boolean, error?: string}>}
   */
  static async checkFilesExist(rulesetId) {
    try {
      const jsonKey = `${S3_CONFIG.paths.json}${rulesetId}.json`
      const zipKey = `${S3_CONFIG.paths.zip}${rulesetId}.zip`
      
      const [jsonResult, zipResult] = await Promise.allSettled([
        s3Client.send(new HeadObjectCommand({ Bucket: S3_CONFIG.bucket, Key: jsonKey })),
        s3Client.send(new HeadObjectCommand({ Bucket: S3_CONFIG.bucket, Key: zipKey }))
      ])
      
      return {
        json: jsonResult.status === 'fulfilled',
        zip: zipResult.status === 'fulfilled'
      }
    } catch (error) {
      console.error('Error checking file existence:', error)
      return {
        json: false,
        zip: false,
        error: error.message
      }
    }
  }

  /**
   * Get file metadata from S3
   * @param {string} rulesetId - Unique identifier for the ruleset
   * @param {string} fileType - 'json' or 'zip'
   * @returns {Promise<{success: boolean, metadata: Object, error?: string}>}
   */
  static async getFileMetadata(rulesetId, fileType) {
    try {
      const key = fileType === 'json' 
        ? `${S3_CONFIG.paths.json}${rulesetId}.json`
        : `${S3_CONFIG.paths.zip}${rulesetId}.zip`
      
      const command = new HeadObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key
      })
      
      const response = await s3Client.send(command)
      
      return {
        success: true,
        metadata: {
          size: response.ContentLength,
          lastModified: response.LastModified,
          contentType: response.ContentType,
          metadata: response.Metadata
        }
      }
    } catch (error) {
      console.error('Error getting file metadata:', error)
      return {
        success: false,
        metadata: null,
        error: error.message
      }
    }
  }
}