/**
 * File operations API handler for Cloudflare Workers
 * Handles file upload, download, and deletion operations
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Create S3 client from environment variables
 * @param {Object} env - Environment variables
 * @returns {S3Client} - Configured S3 client
 */
function createS3Client(env) {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY
    },
    forcePathStyle: true
  })
}

/**
 * Handle file operations
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
export async function handleFileOperations(request, env, ctx, corsHeaders) {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)
  
  // Expected format: /api/files/{rulesetId}/{action}
  if (pathParts.length < 3) {
    return new Response(JSON.stringify({
      error: true,
      message: 'Invalid file operation path',
      code: 'INVALID_PATH'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  const rulesetId = pathParts[2]
  const action = pathParts[3]

  try {
    const s3Client = createS3Client(env)
    const bucket = env.S3_BUCKET || 'auto366-rulesets'

    switch (action) {
      case 'upload':
        return await handleFileUpload(request, s3Client, bucket, rulesetId, corsHeaders)
      
      case 'download':
        return await handleFileDownload(request, s3Client, bucket, rulesetId, pathParts[4], corsHeaders)
      
      case 'delete':
        return await handleFileDelete(request, s3Client, bucket, rulesetId, pathParts[4], corsHeaders)
      
      case 'info':
        return await handleFileInfo(request, s3Client, bucket, rulesetId, corsHeaders)
      
      default:
        return new Response(JSON.stringify({
          error: true,
          message: 'Unknown file operation',
          code: 'UNKNOWN_OPERATION'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
    }
  } catch (error) {
    console.error('File operation error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'File operation failed',
      code: 'OPERATION_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle file upload
 * @param {Request} request - The incoming request
 * @param {S3Client} s3Client - S3 client
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileUpload(request, s3Client, bucket, rulesetId, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      error: true,
      message: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED'
    }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const formData = await request.formData()
    const jsonFile = formData.get('json')
    const zipFile = formData.get('zip')

    const results = {}

    // Upload JSON file if provided
    if (jsonFile) {
      const jsonKey = `json/${rulesetId}.json`
      const jsonContent = await jsonFile.arrayBuffer()
      
      const jsonCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: jsonKey,
        Body: jsonContent,
        ContentType: 'application/json',
        Metadata: {
          rulesetId,
          uploadedAt: new Date().toISOString()
        }
      })

      await s3Client.send(jsonCommand)
      results.json = {
        success: true,
        key: jsonKey,
        size: jsonContent.byteLength
      }
    }

    // Upload ZIP file if provided
    if (zipFile) {
      const zipKey = `zip/${rulesetId}.zip`
      const zipContent = await zipFile.arrayBuffer()
      
      const zipCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: zipKey,
        Body: zipContent,
        ContentType: 'application/zip',
        Metadata: {
          rulesetId,
          uploadedAt: new Date().toISOString()
        }
      })

      await s3Client.send(zipCommand)
      results.zip = {
        success: true,
        key: zipKey,
        size: zipContent.byteLength
      }
    }

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('File upload error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'File upload failed',
      code: 'UPLOAD_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle file download
 * @param {Request} request - The incoming request
 * @param {S3Client} s3Client - S3 client
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {string} fileType - File type ('json' or 'zip')
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileDownload(request, s3Client, bucket, rulesetId, fileType, corsHeaders) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({
      error: true,
      message: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED'
    }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  if (!fileType || !['json', 'zip'].includes(fileType)) {
    return new Response(JSON.stringify({
      error: true,
      message: 'Invalid file type. Must be json or zip',
      code: 'INVALID_FILE_TYPE'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const key = `${fileType}/${rulesetId}.${fileType}`
    
    // Check if file exists
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    })
    
    await s3Client.send(headCommand)
    
    // Generate signed URL
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
    
    const signedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 })
    
    return new Response(JSON.stringify({
      success: true,
      downloadUrl: signedUrl,
      expiresIn: 3600
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    if (error.name === 'NotFound') {
      return new Response(JSON.stringify({
        error: true,
        message: 'File not found',
        code: 'FILE_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    console.error('File download error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'File download failed',
      code: 'DOWNLOAD_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle file deletion
 * @param {Request} request - The incoming request
 * @param {S3Client} s3Client - S3 client
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {string} fileType - File type ('json', 'zip', or 'all')
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileDelete(request, s3Client, bucket, rulesetId, fileType, corsHeaders) {
  if (request.method !== 'DELETE') {
    return new Response(JSON.stringify({
      error: true,
      message: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED'
    }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const results = {}

    if (fileType === 'all') {
      // Delete both JSON and ZIP files
      const jsonKey = `json/${rulesetId}.json`
      const zipKey = `zip/${rulesetId}.zip`

      const [jsonResult, zipResult] = await Promise.allSettled([
        s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: jsonKey })),
        s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: zipKey }))
      ])

      results.json = { success: jsonResult.status === 'fulfilled' }
      results.zip = { success: zipResult.status === 'fulfilled' }
    } else if (['json', 'zip'].includes(fileType)) {
      // Delete specific file type
      const key = `${fileType}/${rulesetId}.${fileType}`
      
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      }))

      results[fileType] = { success: true }
    } else {
      return new Response(JSON.stringify({
        error: true,
        message: 'Invalid file type. Must be json, zip, or all',
        code: 'INVALID_FILE_TYPE'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('File deletion error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'File deletion failed',
      code: 'DELETION_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle file info request
 * @param {Request} request - The incoming request
 * @param {S3Client} s3Client - S3 client
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileInfo(request, s3Client, bucket, rulesetId, corsHeaders) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({
      error: true,
      message: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED'
    }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const jsonKey = `json/${rulesetId}.json`
    const zipKey = `zip/${rulesetId}.zip`

    const [jsonResult, zipResult] = await Promise.allSettled([
      s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: jsonKey })),
      s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: zipKey }))
    ])

    const info = {
      json: {
        exists: jsonResult.status === 'fulfilled',
        size: jsonResult.status === 'fulfilled' ? jsonResult.value.ContentLength : null,
        lastModified: jsonResult.status === 'fulfilled' ? jsonResult.value.LastModified : null
      },
      zip: {
        exists: zipResult.status === 'fulfilled',
        size: zipResult.status === 'fulfilled' ? zipResult.value.ContentLength : null,
        lastModified: zipResult.status === 'fulfilled' ? zipResult.value.LastModified : null
      }
    }

    return new Response(JSON.stringify({
      success: true,
      info
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('File info error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to get file info',
      code: 'INFO_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}