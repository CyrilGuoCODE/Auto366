/**
 * Admin operations API handler for Cloudflare Workers
 * Handles admin-only operations with authentication
 */

import { createClient } from '@supabase/supabase-js'

/**
 * Create Supabase client with service role key for admin operations
 * @param {Object} env - Environment variables
 * @returns {Object} - Configured Supabase client with admin privileges
 */
function createSupabaseAdminClient(env) {
  return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
}

/**
 * Create regular Supabase client for authentication
 * @param {Object} env - Environment variables
 * @returns {Object} - Configured Supabase client
 */
function createSupabaseClient(env) {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
}

/**
 * Verify admin authentication from request headers
 * @param {Request} request - The incoming request
 * @param {Object} supabase - Supabase client
 * @returns {Promise<{user: Object|null, error: any}>}
 */
async function verifyAdminAuth(request, supabase) {
  const authHeader = request.headers.get('Authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid authorization header' }
  }

  const token = authHeader.substring(7)
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user) {
      return { user: null, error: 'Invalid token or user not found' }
    }

    return { user, error: null }
  } catch (error) {
    return { user: null, error: error.message }
  }
}

/**
 * Handle admin operations
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
export async function handleAdminOperations(request, env, ctx, corsHeaders) {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)
  
  // Expected format: /api/admin/{action} or /api/admin/{resource}/{id}/{action}
  if (pathParts.length < 3) {
    return new Response(JSON.stringify({
      error: true,
      message: 'Invalid admin operation path',
      code: 'INVALID_PATH'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  try {
    const supabase = createSupabaseClient(env)
    const supabaseAdmin = createSupabaseAdminClient(env)
    
    const action = pathParts[2]
    
    // Handle authentication endpoints (no auth required)
    if (action === 'login') {
      return await handleLogin(request, supabase, corsHeaders)
    }
    
    if (action === 'logout') {
      return await handleLogout(request, supabase, corsHeaders)
    }

    // All other endpoints require authentication
    const { user, error: authError } = await verifyAdminAuth(request, supabase)
    
    if (authError || !user) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
        details: authError
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Handle authenticated admin operations
    switch (action) {
      case 'verify':
        return await handleVerifyAuth(user, corsHeaders)
      
      case 'rulesets':
        return await handleRulesetManagement(request, pathParts, user, supabaseAdmin, env, corsHeaders)
      
      default:
        return new Response(JSON.stringify({
          error: true,
          message: 'Admin operation not found',
          code: 'OPERATION_NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
    }

  } catch (error) {
    console.error('Admin operation error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Admin operation failed',
      code: 'OPERATION_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle admin login
 * @param {Request} request - The incoming request
 * @param {Object} supabase - Supabase client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleLogin(request, supabase, corsHeaders) {
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
    const { email, password } = await request.json()

    if (!email || !password) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      return new Response(JSON.stringify({
        error: true,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
        details: error.message
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Update last login timestamp
    await supabase
      .from('admin_profiles')
      .upsert({
        id: data.user.id,
        email: data.user.email,
        last_login: new Date().toISOString()
      }, {
        onConflict: 'id'
      })

    return new Response(JSON.stringify({
      success: true,
      data: {
        user: data.user,
        session: data.session
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Login error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Login failed',
      code: 'LOGIN_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle admin logout
 * @param {Request} request - The incoming request
 * @param {Object} supabase - Supabase client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleLogout(request, supabase, corsHeaders) {
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
    const { error } = await supabase.auth.signOut()

    if (error) {
      throw error
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Logged out successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Logout error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Logout failed',
      code: 'LOGOUT_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Handle auth verification
 * @param {Object} user - Authenticated user
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleVerifyAuth(user, corsHeaders) {
  return new Response(JSON.stringify({
    success: true,
    data: {
      user,
      authenticated: true
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  })
}

/**
 * Handle ruleset management operations
 * @param {Request} request - The incoming request
 * @param {Array} pathParts - URL path parts
 * @param {Object} user - Authenticated user
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} env - Environment variables
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function handleRulesetManagement(request, pathParts, user, supabaseAdmin, env, corsHeaders) {
  // Expected formats:
  // /api/admin/rulesets (GET - get pending rulesets)
  // /api/admin/rulesets/{id}/approve (POST)
  // /api/admin/rulesets/{id}/reject (POST)
  // /api/admin/rulesets/{id} (DELETE)
  // /api/admin/rulesets/{id}/files (PUT - update files)

  if (pathParts.length === 3) {
    // /api/admin/rulesets
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const status = url.searchParams.get('status') || 'all'
      return await getAllRulesets(supabaseAdmin, corsHeaders, status)
    }
  } else if (pathParts.length === 5) {
    // /api/admin/rulesets/{id}/{action}
    const rulesetId = pathParts[3]
    const action = pathParts[4]

    switch (action) {
      case 'approve':
        if (request.method === 'POST') {
          return await approveRuleset(rulesetId, user.id, supabaseAdmin, corsHeaders)
        }
        break
      
      case 'reject':
        if (request.method === 'POST') {
          return await rejectRuleset(rulesetId, supabaseAdmin, corsHeaders)
        }
        break
      
      case 'files':
        if (request.method === 'PUT') {
          return await updateRulesetFiles(request, rulesetId, supabaseAdmin, env, corsHeaders)
        }
        break
    }
  } else if (pathParts.length === 4) {
    // /api/admin/rulesets/{id}
    const rulesetId = pathParts[3]
    
    if (request.method === 'DELETE') {
      return await deleteRuleset(rulesetId, supabaseAdmin, env, corsHeaders)
    }
  }

  return new Response(JSON.stringify({
    error: true,
    message: 'Invalid ruleset management operation',
    code: 'INVALID_OPERATION'
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  })
}

/**
 * Get rulesets for admin review (all statuses or filtered by status)
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} corsHeaders - CORS headers
 * @param {string} status - Optional status filter ('pending', 'approved', 'rejected', 'all')
 * @returns {Response} - The response
 */
async function getAllRulesets(supabaseAdmin, corsHeaders, status = 'all') {
  try {
    let query = supabaseAdmin
      .from('rulesets')
      .select('*')
      .order('created_at', { ascending: false })

    // Apply status filter if not 'all'
    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    return new Response(JSON.stringify({
      success: true,
      data: data || []
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
 * Get pending rulesets for admin review
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function getPendingRulesets(supabaseAdmin, corsHeaders) {
  return await getAllRulesets(supabaseAdmin, corsHeaders, 'pending')
}

/**
 * Approve a ruleset
 * @param {string} rulesetId - Ruleset ID
 * @param {string} adminId - Admin user ID
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function approveRuleset(rulesetId, adminId, supabaseAdmin, corsHeaders) {
  try {
    const { data, error } = await supabaseAdmin
      .from('rulesets')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: adminId,
        updated_at: new Date().toISOString()
      })
      .eq('id', rulesetId)
      .select()
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
      data,
      message: 'Ruleset approved successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Approve ruleset error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to approve ruleset',
      code: 'APPROVE_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Reject a ruleset
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function rejectRuleset(rulesetId, supabaseAdmin, corsHeaders) {
  try {
    const { data, error } = await supabaseAdmin
      .from('rulesets')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      })
      .eq('id', rulesetId)
      .select()
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
      data,
      message: 'Ruleset rejected successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Reject ruleset error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to reject ruleset',
      code: 'REJECT_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Delete a ruleset and its associated files
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} env - Environment variables
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function deleteRuleset(rulesetId, supabaseAdmin, env, corsHeaders) {
  try {
    // First, delete the files from storage
    const { handleFileOperations } = await import('./files.js')
    
    const deleteRequest = new Request(`http://localhost/api/files/${rulesetId}/delete/all`, {
      method: 'DELETE'
    })

    await handleFileOperations(deleteRequest, env, {}, corsHeaders)

    // Then delete the database record
    const { data, error } = await supabaseAdmin
      .from('rulesets')
      .delete()
      .eq('id', rulesetId)
      .select()
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
      data,
      message: 'Ruleset deleted successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Delete ruleset error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to delete ruleset',
      code: 'DELETE_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Update ruleset files
 * @param {Request} request - The incoming request
 * @param {string} rulesetId - Ruleset ID
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {Object} env - Environment variables
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function updateRulesetFiles(request, rulesetId, supabaseAdmin, env, corsHeaders) {
  try {
    const formData = await request.formData()
    const jsonFile = formData.get('json')
    const zipFile = formData.get('zip')

    if (!jsonFile && !zipFile) {
      return new Response(JSON.stringify({
        error: true,
        message: 'At least one file (JSON or ZIP) must be provided',
        code: 'NO_FILES'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Validate JSON file if provided
    if (jsonFile) {
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
    }

    // Upload new files
    const { handleFileOperations } = await import('./files.js')
    
    const uploadFormData = new FormData()
    if (jsonFile) uploadFormData.append('json', jsonFile)
    if (zipFile) uploadFormData.append('zip', zipFile)

    const uploadRequest = new Request(`http://localhost/api/files/${rulesetId}/upload`, {
      method: 'POST',
      body: uploadFormData
    })

    const uploadResponse = await handleFileOperations(uploadRequest, env, {}, corsHeaders)
    const uploadResult = await uploadResponse.json()

    if (!uploadResult.success) {
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

    // Update database record with new file sizes
    const updates = {
      updated_at: new Date().toISOString()
    }

    if (jsonFile) {
      updates.json_file_size = jsonFile.size
    }

    if (zipFile) {
      updates.zip_file_size = zipFile.size
      updates.has_injection_package = true
    }

    const { data, error } = await supabaseAdmin
      .from('rulesets')
      .update(updates)
      .eq('id', rulesetId)
      .select()
      .single()

    if (error) {
      throw error
    }

    return new Response(JSON.stringify({
      success: true,
      data,
      message: 'Files updated successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Update files error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to update files',
      code: 'UPDATE_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}