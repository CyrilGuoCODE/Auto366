/**
 * Answer operations API handler for Cloudflare Workers
 * Handles answer parsing and processing operations
 */

/**
 * Handle answer operations
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @param {Object} ctx - Execution context
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
export async function handleAnswerOperations(request, env, ctx, corsHeaders) {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)
  
  // Expected format: /api/answers/{action}
  if (pathParts.length < 3) {
    return new Response(JSON.stringify({
      error: true,
      message: 'Invalid answer operation path',
      code: 'INVALID_PATH'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }

  const action = pathParts[2]

  try {
    switch (action) {
      case 'parse':
        return await parseAnswerFile(request, corsHeaders)
      
      default:
        return new Response(JSON.stringify({
          error: true,
          message: 'Answer operation not found',
          code: 'OPERATION_NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
    }

  } catch (error) {
    console.error('Answer operation error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Answer operation failed',
      code: 'OPERATION_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Parse uploaded practice file and extract answers
 * @param {Request} request - The incoming request
 * @param {Object} corsHeaders - CORS headers
 * @returns {Response} - The response
 */
async function parseAnswerFile(request, corsHeaders) {
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
    const file = formData.get('file')

    if (!file) {
      return new Response(JSON.stringify({
        error: true,
        message: 'No file provided',
        code: 'NO_FILE'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }

    // Read file content
    const fileContent = await file.text()
    
    // Parse answers based on file type and content
    const answers = await parseFileContent(fileContent, file.name)

    return new Response(JSON.stringify({
      success: true,
      data: {
        fileName: file.name,
        fileSize: file.size,
        answers,
        totalAnswers: answers.length,
        parsedAt: new Date().toISOString()
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })

  } catch (error) {
    console.error('Parse answer file error:', error)
    return new Response(JSON.stringify({
      error: true,
      message: 'Failed to parse answer file',
      code: 'PARSE_FAILED',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    })
  }
}

/**
 * Parse file content and extract answers
 * @param {string} content - File content
 * @param {string} fileName - File name
 * @returns {Promise<Array>} - Parsed answers
 */
async function parseFileContent(content, fileName) {
  const answers = []
  
  try {
    // Try to parse as JSON first
    const jsonData = JSON.parse(content)
    
    if (Array.isArray(jsonData)) {
      // Handle array of answers
      return jsonData.map((item, index) => ({
        id: index + 1,
        question: item.question || `Question ${index + 1}`,
        answer: item.answer || item.correct_answer || item.result,
        type: item.type || 'unknown',
        confidence: item.confidence || 1.0,
        sourceFile: fileName,
        pattern: 'json'
      }))
    } else if (jsonData.answers) {
      // Handle object with answers property
      return jsonData.answers.map((item, index) => ({
        id: index + 1,
        question: item.question || `Question ${index + 1}`,
        answer: item.answer || item.correct_answer || item.result,
        type: item.type || 'unknown',
        confidence: item.confidence || 1.0,
        sourceFile: fileName,
        pattern: 'json'
      }))
    }
  } catch (error) {
    // Not JSON, try text parsing
  }

  // Parse as text file
  const lines = content.split('\n').filter(line => line.trim())
  let questionCounter = 1

  for (const line of lines) {
    const trimmedLine = line.trim()
    
    if (!trimmedLine) continue

    // Pattern 1: Question: Answer format
    const questionAnswerMatch = trimmedLine.match(/^(.+?)[:：]\s*(.+)$/)
    if (questionAnswerMatch) {
      answers.push({
        id: questionCounter++,
        question: questionAnswerMatch[1].trim(),
        answer: questionAnswerMatch[2].trim(),
        type: 'qa',
        confidence: 0.9,
        sourceFile: fileName,
        pattern: 'question_answer'
      })
      continue
    }

    // Pattern 2: Number. Question - Answer format
    const numberedMatch = trimmedLine.match(/^(\d+)\.?\s*(.+?)\s*[-–—]\s*(.+)$/)
    if (numberedMatch) {
      answers.push({
        id: parseInt(numberedMatch[1]),
        question: numberedMatch[2].trim(),
        answer: numberedMatch[3].trim(),
        type: 'numbered',
        confidence: 0.9,
        sourceFile: fileName,
        pattern: 'numbered'
      })
      continue
    }

    // Pattern 3: Answer only (A, B, C, D format)
    const answerOnlyMatch = trimmedLine.match(/^[ABCD]$/i)
    if (answerOnlyMatch) {
      answers.push({
        id: questionCounter++,
        question: `Question ${questionCounter - 1}`,
        answer: answerOnlyMatch[0].toUpperCase(),
        type: 'choice',
        confidence: 0.8,
        sourceFile: fileName,
        pattern: 'choice_only'
      })
      continue
    }

    // Pattern 4: True/False format
    const trueFalseMatch = trimmedLine.match(/^(true|false|正确|错误|对|错|T|F)$/i)
    if (trueFalseMatch) {
      const answer = trueFalseMatch[1].toLowerCase()
      const normalizedAnswer = answer === 'true' || answer === '正确' || answer === '对' || answer === 't' ? '正确' : '错误'
      
      answers.push({
        id: questionCounter++,
        question: `Question ${questionCounter - 1}`,
        answer: normalizedAnswer,
        type: 'boolean',
        confidence: 0.8,
        sourceFile: fileName,
        pattern: 'true_false'
      })
      continue
    }

    // Pattern 5: Generic line (treat as answer)
    if (trimmedLine.length > 0 && trimmedLine.length < 200) {
      answers.push({
        id: questionCounter++,
        question: `Question ${questionCounter - 1}`,
        answer: trimmedLine,
        type: 'generic',
        confidence: 0.6,
        sourceFile: fileName,
        pattern: 'generic'
      })
    }
  }

  return answers
}