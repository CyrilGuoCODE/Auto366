/**
 * Ruleset operations API handler for Cloudflare Workers
 * Handles public ruleset operations
 */

import { createClient } from '@supabase/supabase-js'

/**
 * Create Supabase client from environment variables
 * @param {Object} env - Environment variables
 * @returns {Object} - Configured Supabase client
 */
function createSupabaseClient(env) {
  // Use service key for server-side operations to bypass RLS
  return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
}

/**
 * Handle ruleset operations
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
export async function handleRulesetOperations(request, env, ctx, corsHeaders) {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Expected format: /api/rulesets or /api/rulesets/{id} or /api/rulesets/{id}/{action}
  // pathParts should be ['api', 'rulesets'] or ['api', 'rulesets', 'id'] or ['api', 'rulesets', 'id', 'action']
  if (pathParts.length < 2 || pathParts[0] !== 'api' || pathParts[1] !== 'rulesets') {
    return new Response(JSON.stringify({
      error: true,
      message: 'Invalid ruleset operation path',
      code: 'INVALID_PATH'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const supabase = createSupabaseClient(env)

    // Handle different routes
    if (pathParts.length === 2) {
      // /api/rulesets
      if (request.method === 'GET') {
        return await getRulesets(request, supabase, corsHeaders)
      } else if (request.method === 'POST') {
        return await createRuleset(request, supabase, env, corsHeaders)
      }
    } else if (pathParts.length === 3) {
      // /api/rulesets/{id}
      const rulesetId = pathParts[2]
      if (request.method === 'GET') {
        return await getRulesetById(rulesetId, supabase, corsHeaders)
      }
    } else if (pathParts.length === 4) {
      // /api/rulesets/{id}/{action}
      const rulesetId = pathParts[2]
      const action = pathParts[3]

      if (action === 'download') {
        return await handleDownload(request, rulesetId, supabase, env, corsHeaders)
      }
    }

    return new Response(JSON.stringify({
      error: true,
      message: 'Ruleset operation not found',
      code: 'OPERATION_NOT_FOUND'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Ruleset operation error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Ruleset operation failed',
      code: 'OPERATION_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Get rulesets with optional filtering and pagination
 * @param {Request} request - The incoming request
 * @param {Object} supabase - Supabase client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function getRulesets(request, supabase, corsHeaders) {
  const url = new URL(request.url)
  const searchParams = url.searchParams

  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'approved' // Default to approved for public access
  const sortBy = searchParams.get('sortBy') || 'created_at'
  const sortOrder = searchParams.get('sortOrder') || 'desc'
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    let query = supabase
      .from('rulesets')
      .select('*', { count: 'exact' })

    // Apply status filter
    if (status !== 'all') {
      query = query.eq('status', status)
    }

    // Apply search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,author.ilike.%${search}%,description.ilike.%${search}%`)
    }

    // Apply sorting
    const sortField = sortBy === 'latest' ? 'created_at' :
      sortBy === 'downloads' ? 'download_count' :
        sortBy === 'name' ? 'name' : 'created_at'

    query = query.order(sortField, { ascending: sortOrder === 'asc' })

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      throw error
    }

    return new Response(JSON.stringify({
      success: true,
      data: data || [],
      count: count || 0,
      pagination: {
        limit,
        offset,
        hasMore: count > offset + limit
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Get rulesets error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to fetch rulesets',
      code: 'FETCH_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Get a specific ruleset by ID
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} supabase - Supabase client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function getRulesetById(rulesetId, supabase, corsHeaders) {
  try {
    const { data, error } = await supabase
      .from('rulesets')
      .select('*')
      .eq('id', rulesetId)
      .eq('status', 'approved')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return new Response(JSON.stringify({
          error: true,
          message: 'Ruleset not found',
          code: 'RULESET_NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }
      throw error
    }

    return new Response(JSON.stringify({
      success: true,
      data
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Get ruleset by ID error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to fetch ruleset',
      code: 'FETCH_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Create a new ruleset (pending approval)
 * @param {Request} request - The incoming request
 * @param {Object} supabase - Supabase client
 * @param {Object} env - Environment variables
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function createRuleset(request, supabase, env, corsHeaders) {
  try {
    const formData = await request.formData()

    const name = formData.get('name')
    const description = formData.get('description')
    const author = formData.get('author')
    const jsonFile = formData.get('json')
    const zipFile = formData.get('zip')

    // Validate required fields
    if (!name || !description || !author || !jsonFile) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Missing required fields: name, description, author, json file',
        code: 'MISSING_FIELDS'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Validate JSON file
    try {
      const jsonContent = await jsonFile.text()
      JSON.parse(jsonContent)
    } catch (error) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Invalid JSON file format',
        code: 'INVALID_JSON'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Create ruleset record in database
    const { data: ruleset, error: dbError } = await supabase
      .from('rulesets')
      .insert({
        name,
        description,
        author,
        status: 'pending',
        json_file_size: jsonFile.size,
        zip_file_size: zipFile ? zipFile.size : null,
        has_injection_package: !!zipFile,
        download_count: 0
      })
      .select()
      .single()

    if (dbError) {
      throw dbError
    }

    // Upload files to storage
    const { handleFileOperations } = await import('./files.js')

    // Create a new request for file upload
    const uploadFormData = new FormData()
    uploadFormData.append('json', jsonFile)
    if (zipFile) {
      uploadFormData.append('zip', zipFile)
    }

    const uploadRequest = new Request(`${request.url.split('/api/')[0]}/api/files/${ruleset.id}/upload`, {
      method: 'POST',
      body: uploadFormData
    })

    const uploadResponse = await handleFileOperations(uploadRequest, env, {}, corsHeaders)
    const uploadResult = await uploadResponse.json()

    if (!uploadResult.success) {
      // Rollback database record if file upload fails
      await supabase.from('rulesets').delete().eq('id', ruleset.id)

      return new Response(JSON.stringify({
        error: true,
        message: 'File upload failed',
        code: 'UPLOAD_FAILED',
        details: uploadResult.error
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      data: ruleset,
      message: 'Ruleset uploaded successfully and is pending approval'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Create ruleset error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to create ruleset',
      code: 'CREATE_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle file download and increment download count
 * @param {Request} request - The incoming request
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} supabase - Supabase client
 * @param {Object} env - Environment variables
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleDownload(request, rulesetId, supabase, env, corsHeaders) {
  const url = new URL(request.url)
  const fileType = url.searchParams.get('type') // 'json' or 'zip'

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
    // Verify ruleset exists and is approved
    const { data: ruleset, error: rulesetError } = await supabase
      .from('rulesets')
      .select('*')
      .eq('id', rulesetId)
      .eq('status', 'approved')
      .single()

    if (rulesetError || !ruleset) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Ruleset not found or not approved',
        code: 'RULESET_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Check if requested file type exists
    if (fileType === 'zip' && !ruleset.has_injection_package) {
      return new Response(JSON.stringify({
        error: true,
        message: 'ZIP file not available for this ruleset',
        code: 'FILE_NOT_AVAILABLE'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Get download URL from file service
    const { handleFileOperations } = await import('./files.js')

    const downloadRequest = new Request(`${request.url.split('/api/')[0]}/api/files/${rulesetId}/download/${fileType}`, {
      method: 'GET'
    })

    const downloadResponse = await handleFileOperations(downloadRequest, env, {}, corsHeaders)
    const downloadResult = await downloadResponse.json()

    if (!downloadResult.success) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Failed to generate download URL',
        code: 'DOWNLOAD_FAILED',
        details: downloadResult.error
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Increment download count
    try {
      const { data: currentRuleset } = await supabase
        .from('rulesets')
        .select('download_count')
        .eq('id', rulesetId)
        .single()

      if (currentRuleset) {
        await supabase
          .from('rulesets')
          .update({
            download_count: (currentRuleset.download_count || 0) + 1
          })
          .eq('id', rulesetId)
      }
    } catch (incrementError) {
      console.warn('Failed to increment download count:', incrementError.message)
      // Don't fail the download for this, just log the warning
    }

    return new Response(JSON.stringify({
      success: true,
      downloadUrl: downloadResult.downloadUrl,
      expiresIn: downloadResult.expiresIn,
      fileName: `${ruleset.name}.${fileType}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Handle download error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Download failed',
      code: 'DOWNLOAD_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}