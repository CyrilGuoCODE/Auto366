/**
 * Cloudflare Workers API entry point
 * Handles routing for all API endpoints
 */

import { handleFileOperations } from './files.js'
import { handleRulesetOperations } from './rulesets.js'
import { handleAdminOperations } from './admin.js'
import { handleAnswerOperations } from './answers.js'

/**
 * Main request handler for Cloudflare Workers
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @returns {Response} - The response
 */
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url)
      const path = url.pathname

      // CORS headers for all responses
      const corsHeaders = {
        'Access-Control-Allow-Origin': env.CORS_ORIGINS || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }

      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: corsHeaders
        })
      }

      // Route API requests
      if (path.startsWith('/api/files')) {
        return await handleFileOperations(request, env, ctx, corsHeaders)
      }
      
      if (path.startsWith('/api/rulesets')) {
        return await handleRulesetOperations(request, env, ctx, corsHeaders)
      }
      
      if (path.startsWith('/api/admin')) {
        return await handleAdminOperations(request, env, ctx, corsHeaders)
      }

      if (path.startsWith('/api/answers')) {
        return await handleAnswerOperations(request, env, ctx, corsHeaders)
      }

      // Handle static file serving (fallback to index.html for SPA)
      if (path.startsWith('/api/')) {
        return new Response('API endpoint not found', {
          status: 404,
          headers: corsHeaders
        })
      }

      // Serve static files or SPA fallback
      // For SPA routing, we need to serve index.html for all non-API routes
      // that don't correspond to actual static files
      try {
        // First, try to serve the requested file
        const response = await env.ASSETS.fetch(request)
        
        // If the file exists, serve it
        if (response.status !== 404) {
          return response
        }
        
        // If file not found and it's not an API route, serve index.html for SPA routing
        if (!path.startsWith('/api/')) {
          const indexRequest = new Request(new URL('/', request.url), {
            method: 'GET',
            headers: request.headers
          })
          return await env.ASSETS.fetch(indexRequest)
        }
        
        // If it's an API route that wasn't handled above, return 404
        return response
      } catch (error) {
        console.error('Asset serving error:', error)
        
        // Fallback to index.html for SPA routing
        if (!path.startsWith('/api/')) {
          try {
            const indexRequest = new Request(new URL('/', request.url), {
              method: 'GET',
              headers: request.headers
            })
            return await env.ASSETS.fetch(indexRequest)
          } catch (indexError) {
            console.error('Index.html serving error:', indexError)
            return new Response('Application not available', {
              status: 500,
              headers: corsHeaders
            })
          }
        }
        
        return new Response('Asset not found', {
          status: 404,
          headers: corsHeaders
        })
      }

    } catch (error) {
      console.error('Worker error:', error)
      return new Response(JSON.stringify({
        error: true,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      })
    }
  }
}