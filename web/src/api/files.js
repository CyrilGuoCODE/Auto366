/**
 * File operations API handler for Cloudflare Workers
 * Handles file upload, download, and deletion operations using direct S3 API calls
 */

/**
 * Create AWS Signature V2 for S3 requests
 * @param {string} method - HTTP method
 * @param {string} path - S3 path
 * @param {Object} env - Environment variables
 * @param {Object} headers - Request headers
 * @returns {Object} - Headers for S3 request
 */
async function createS3Headers(method, path, env, headers = {}) {
  const contentType = headers['Content-Type'] || 'application/octet-stream'
  const contentLength = headers['Content-Length'] || '0'
  const contentMD5 = headers['Content-MD5'] || ''
  
  // Create RFC 2822 date
  const date = new Date().toUTCString()
  
  // Build canonical string for AWS Signature V2
  const bucket = env.S3_BUCKET || 'auto366-rulesets'
  const canonicalizedResource = `/${bucket}/${path.replace(/^\//, '')}`
  
  const stringToSign = [
    method,
    contentMD5,
    contentType,
    date,
    canonicalizedResource
  ].join('\n')
  
  console.log('String to sign:', stringToSign)
  
  // Create HMAC-SHA1 signature
  const signature = await createHmacSha1Signature(stringToSign, env.S3_SECRET_KEY)
  
  return {
    'Content-Type': contentType,
    'Content-Length': contentLength,
    'Date': date,
    'Authorization': `AWS ${env.S3_ACCESS_KEY}:${signature}`
  }
}

/**
 * Create HMAC-SHA1 signature for AWS Signature V2
 * @param {string} stringToSign - String to sign
 * @param {string} secretKey - AWS secret key
 * @returns {string} - Base64 encoded signature
 */
async function createHmacSha1Signature(stringToSign, secretKey) {
  // Convert string and key to Uint8Array
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secretKey)
  const messageData = encoder.encode(stringToSign)
  
  // Import the key for HMAC
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  
  // Create signature
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  
  // Convert to base64
  const signatureArray = new Uint8Array(signature)
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
  
  return signatureBase64
}

/**
 * Make S3 API request using AWS Signature V2 (optimized for your S3 compatible service)
 * @param {string} method - HTTP method
 * @param {string} path - S3 path
 * @param {Object} env - Environment variables
 * @param {Object} options - Request options
 * @returns {Response} - S3 response
 */
async function makeS3Request(method, path, env, options = {}) {
  const bucket = env.S3_BUCKET || 'auto366-rulesets'
  const endpoint = env.S3_ENDPOINT || 'https://s3.amazonaws.com'
  
  // Ensure endpoint doesn't end with slash and path doesn't start with slash
  const cleanEndpoint = endpoint.replace(/\/$/, '')
  const cleanPath = path.replace(/^\//, '')
  
  // Use AWS Signature V2 (we know this works for your service)
  const url = `${cleanEndpoint}/${bucket}/${cleanPath}`
  const headers = await createS3Headers(method, path, env, options.headers || {})
  
  console.log(`Making S3 request with AWS Signature V2: ${method} ${url}`)
  console.log('Headers:', headers)
  
  const response = await fetch(url, {
    method,
    headers,
    body: options.body
  })
  
  console.log(`S3 response: ${response.status} ${response.statusText}`)
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'No error text')
    console.log('Error details:', errorText)
  }
  
  return response
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
    const bucket = env.S3_BUCKET || 'auto366-rulesets'

    switch (action) {
      case 'upload':
        return await handleFileUpload(request, env, bucket, rulesetId, corsHeaders)
      
      case 'download':
        return await handleFileDownload(request, env, bucket, rulesetId, pathParts[4], corsHeaders)
      
      case 'delete':
        return await handleFileDelete(request, env, bucket, rulesetId, pathParts[4], corsHeaders)
      
      case 'info':
        return await handleFileInfo(request, env, bucket, rulesetId, corsHeaders)
      
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
 * Handle file upload using Path-style S3 requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileUpload(request, env, bucket, rulesetId, corsHeaders) {
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
      
      const response = await makeS3Request('PUT', jsonKey, env, {
        body: jsonContent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': jsonContent.byteLength.toString()
        }
      })

      if (!response.ok) {
        // Try to get more details about the error
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error('JSON upload error details:', errorText)
        throw new Error(`JSON upload failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

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
      
      const response = await makeS3Request('PUT', zipKey, env, {
        body: zipContent,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': zipContent.byteLength.toString()
        }
      })

      if (!response.ok) {
        // Try to get more details about the error
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error('ZIP upload error details:', errorText)
        throw new Error(`ZIP upload failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

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
 * Handle file download using Path-style S3 requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {string} fileType - File type ('json' or 'zip')
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileDownload(request, env, bucket, rulesetId, fileType, corsHeaders) {
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
    
    // Check if file exists with HEAD request
    const headResponse = await makeS3Request('HEAD', key, env)
    
    if (!headResponse.ok) {
      if (headResponse.status === 404) {
        return new Response(JSON.stringify({
          error: true,
          message: 'File not found',
          code: 'FILE_NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
      throw new Error(`File check failed: ${headResponse.status} ${headResponse.statusText}`)
    }
    
    // Generate a simple download URL (in production, you'd want signed URLs)
    const endpoint = env.S3_ENDPOINT || 'https://s3.amazonaws.com'
    const cleanEndpoint = endpoint.replace(/\/$/, '')
    const downloadUrl = `${cleanEndpoint}/${bucket}/${key}`
    
    return new Response(JSON.stringify({
      success: true,
      downloadUrl,
      expiresIn: 3600
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
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
 * @param {Object} env - Environment variables
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {string} fileType - File type ('json', 'zip', or 'all')
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileDelete(request, env, bucket, rulesetId, fileType, corsHeaders) {
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

      const [jsonResponse, zipResponse] = await Promise.allSettled([
        makeS3Request('DELETE', jsonKey, env),
        makeS3Request('DELETE', zipKey, env)
      ])

      results.json = { success: jsonResponse.status === 'fulfilled' && jsonResponse.value.ok }
      results.zip = { success: zipResponse.status === 'fulfilled' && zipResponse.value.ok }
    } else if (['json', 'zip'].includes(fileType)) {
      // Delete specific file type
      const key = `${fileType}/${rulesetId}.${fileType}`
      
      const response = await makeS3Request('DELETE', key, env)
      
      if (!response.ok && response.status !== 404) {
        throw new Error(`Delete failed: ${response.status} ${response.statusText}`)
      }

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
 * @param {Object} env - Environment variables
 * @param {string} bucket - S3 bucket name
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleFileInfo(request, env, bucket, rulesetId, corsHeaders) {
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

    const [jsonResponse, zipResponse] = await Promise.allSettled([
      makeS3Request('HEAD', jsonKey, env),
      makeS3Request('HEAD', zipKey, env)
    ])

    const info = {
      json: {
        exists: jsonResponse.status === 'fulfilled' && jsonResponse.value.ok,
        size: jsonResponse.status === 'fulfilled' && jsonResponse.value.ok ? 
          parseInt(jsonResponse.value.headers.get('content-length')) || null : null,
        lastModified: jsonResponse.status === 'fulfilled' && jsonResponse.value.ok ?
          jsonResponse.value.headers.get('last-modified') : null
      },
      zip: {
        exists: zipResponse.status === 'fulfilled' && zipResponse.value.ok,
        size: zipResponse.status === 'fulfilled' && zipResponse.value.ok ?
          parseInt(zipResponse.value.headers.get('content-length')) || null : null,
        lastModified: zipResponse.status === 'fulfilled' && zipResponse.value.ok ?
          zipResponse.value.headers.get('last-modified') : null
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