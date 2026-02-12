<template>
  <div class="answer-viewer-page">
    <div class="container">
      <div class="answers-display">
        <div class="header">
          <img src="/icon_black.png" class="header-logo" alt="Auto366">
          <h1 class="header-title">Auto366 - 答案查看器</h1>
        </div>
        
        <div class="answers-header">
          <div class="import-answer-button">
            <label for="importAnswer" id="importAnswerBtn">导入答案</label>
            <input type="file" accept=".json,.xml,.html,.txt" id="importAnswer" class="file-input-hidden">
          </div>
          <div class="share-answer-button" id="shareAnswerButtonContainer" style="display: none;">
            <button id="shareAnswerBtn" class="share-btn" title="复制当前页面链接">分享此答案</button>
          </div>
          <div class="sort-mode-selector">
            <label for="sortMode">排序模式：</label>
            <select id="sortMode" v-model="sortMode" @change="displayAnswers">
              <option value="file">按文件排序</option>
              <option value="pattern">按题型排序</option>
            </select>
          </div>
          <div class="clear-answers-button">
            <button id="clearAnswersBtn" class="clear-btn" title="清空提取结果" @click="clearAnswers">
              <span class="clear-btn-text">清空</span>
              <svg t="1756262061386" class="clear-icon" viewBox="0 0 1024 1024" version="1.1"
                  xmlns="http://www.w3.org/2000/svg" p-id="4752" width="256" height="256">
                <path
                    d="M829.952 271.36h-126.976v-51.2a76.288 76.288 0 0 0-75.776-76.288h-256a76.288 76.288 0 0 0-75.776 76.8v51.2H168.448a25.6 25.6 0 0 0 0 51.2h661.504a25.6 25.6 0 0 0 0-51.712z m-178.176 0h-307.2v-51.2a26.112 26.112 0 0 1 25.6-25.6h256a24.576 24.576 0 0 1 24.576 25.6zM448.512 677.376V398.336a25.6 25.6 0 0 0-51.2 0v279.04a25.6 25.6 0 0 0 51.2 0zM601.088 677.376V398.336a25.6 25.6 0 0 0-51.2 0v279.04a25.6 25.6 0 0 0 51.2 0z"
                    fill="" p-id="4753"></path>
                <path
                    d="M735.744 346.624a25.6 25.6 0 0 0-25.6 25.6v381.44a102.4 102.4 0 0 1-102.4 102.4H390.656a102.4 102.4 0 0 1-102.4-102.4V372.224a25.6 25.6 0 0 0-51.2 0v381.44a153.6 153.6 0 0 0 153.6 153.6h217.6a153.6 153.6 0 0 0 153.6-153.6V372.224a25.6 25.6 0 0 0-26.112-25.6z"
                    fill="" p-id="4754"></path>
              </svg>
            </button>
          </div>
        </div>
        
        <div id="answersContainer" class="answers-container">
          <div v-if="answers.length === 0" class="no-answers">暂无答案数据</div>
          <div v-else v-html="answersHtml"></div>
        </div>
        
        <div class="client-recommend">
          <div class="client-recommend-content">
            <div class="client-recommend-text">
              <h3>推荐安装Auto366客户端</h3>
              <p>客户端支持更多题型获取和自动填写，使用更稳定。</p>
            </div>
            <a class="client-recommend-btn" href="https://github.com/cyrilguocode/Auto366/releases/latest" target="_blank" rel="noopener">前往下载</a>
          </div>
        </div>
        
        <!-- 赞赏码和QQ群区域 -->
        <div class="appreciation-wrapper">
          <!-- 赞赏码区域 -->
          <div class="appreciation-section">
            <div class="appreciation-icon" title="如果这个工具对您有帮助，欢迎赞赏支持">
              <svg viewBox="0 0 1024 1024" class="heart-icon">
                <path
                    d="M512 896c-12.8 0-25.6-4.8-35.2-14.4L89.6 494.4c-76.8-76.8-76.8-201.6 0-278.4 38.4-38.4 89.6-57.6 140.8-57.6s102.4 19.2 140.8 57.6L512 356.8l140.8-140.8c38.4-38.4 89.6-57.6 140.8-57.6s102.4 19.2 140.8 57.6c76.8 76.8 76.8 201.6 0 278.4L547.2 881.6c-9.6 9.6-22.4 14.4-35.2 14.4z" />
              </svg>
              <span class="appreciation-text">赞赏</span>
              <div class="appreciation-popup">
                <div class="appreciation-content">
                  <h4>感谢您的支持！</h4>
                  <div class="appreciation-qr-container">
                    <img src="/prize/Cyril_prize.jpg" alt="Cyril赞赏码" class="appreciation-qr">
                    <img src="/prize/Cyp_prize.jpg" alt="CYP赞赏码" class="appreciation-qr">
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- QQ群区域 -->
          <div class="appreciation-section">
            <div class="appreciation-icon" title="加入QQ群，获取更多帮助与支持">
              <svg class="heart-icon" style="fill: #ffffff;" xmlns="http://www.w3.org/2000/svg" width="32" height="32"
                  viewBox="0 0 32 32">
                <path
                    d="M29.11 26.278c-0.72 0.087-2.804-3.296-2.804-3.296 0 1.959-1.009 4.515-3.191 6.362 1.052 0.325 3.428 1.198 2.863 2.151-0.457 0.772-7.844 0.493-9.977 0.252-2.133 0.24-9.52 0.519-9.977-0.252-0.565-0.953 1.807-1.826 2.861-2.151-2.182-1.846-3.191-4.403-3.191-6.362 0 0-2.083 3.384-2.804 3.296-0.335-0.041-0.776-1.853 0.584-6.231 0.641-2.064 1.375-3.78 2.509-6.611-0.191-7.306 2.828-13.435 10.016-13.435 7.109 0.001 10.197 6.008 10.017 13.435 1.132 2.826 1.869 4.553 2.509 6.611 1.361 4.379 0.92 6.191 0.584 6.231z" />
              </svg>
              <span class="appreciation-text">QQ群</span>
              <div class="appreciation-popup">
                <div class="appreciation-content">
                  <h4>加入QQ群，获取更多帮助与支持</h4>
                  <h5 style="color: black;">群号：1003718088</h5>
                  <div class="appreciation-qr-container">
                    <img src="/prize/qq.jpg" alt="QQ群二维码" class="appreciation-qr">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'

// Reactive state
const sortMode = ref('file')
const answers = ref([])
const lastAnswersData = ref(null)
const loadedFromURL = ref(false)
const route = useRoute()

// Pattern priority order
const patternOrder = {
  '听后选择': 1,
  '听后回答': 2,
  '听后转述': 3,
  '朗读短文': 4,
  '分析内容': 5,
  'JSON句子跟读模式': 6,
  'JSON单词发音模式': 7,
  'JSON答案数组模式': 8,
  'JSON题目模式': 9,
  '文本答案模式': 10,
  '文本选项模式': 11,
  'XML正确答案模式': 12,
  'XML题目答案模式': 13,
  '通用XML答案模式': 14
}

// Computed HTML for answers display
const answersHtml = computed(() => {
  if (answers.value.length === 0) return ''
  
  let html = ''
  
  if (sortMode.value === 'file') {
    const answersByFile = {}
    answers.value.forEach(answer => {
      const sourceFile = answer.sourceFile || '未知文件'
      if (!answersByFile[sourceFile]) {
        answersByFile[sourceFile] = []
      }
      answersByFile[sourceFile].push(answer)
    })
    
    Object.keys(answersByFile).forEach(sourceFile => {
      html += `<div class="file-section">
        <div class="file-header">
          <h4>📁 ${sourceFile}</h4>
          <span class="answer-count">${answersByFile[sourceFile].length} 个答案</span>
        </div>`
      
      const sortedAnswers = answersByFile[sourceFile].sort((a, b) => {
        const patternA = patternOrder[a.pattern] || 99
        const patternB = patternOrder[b.pattern] || 99
        return patternA - patternB
      })
      
      sortedAnswers.forEach(answer => {
        html += createAnswerItemHtml(answer)
      })
      
      html += '</div>'
    })
  } else {
    const answersByPattern = {}
    answers.value.forEach(answer => {
      const pattern = answer.pattern || '未知题型'
      if (!answersByPattern[pattern]) {
        answersByPattern[pattern] = []
      }
      answersByPattern[pattern].push(answer)
    })
    
    Object.keys(patternOrder).forEach(pattern => {
      if (answersByPattern[pattern]) {
        html += `<div class="pattern-section">
          <div class="pattern-header">
            <h4><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.50023C18.8978 2.1024 19.4374 1.87891 20 1.87891C20.5626 1.87891 21.1022 2.1024 21.5 2.50023C21.8978 2.89805 22.1213 3.43762 22.1213 4.00023C22.1213 4.56284 21.8978 5.1024 21.5 5.50023L12 15.0002L8 16.0002L9 12.0002L18.5 2.50023Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> ${pattern}</h4>
            <span class="answer-count">${answersByPattern[pattern].length} 个答案</span>
          </div>`
        
        const sortedAnswers = answersByPattern[pattern].sort((a, b) => {
          const fileA = a.sourceFile || '未知文件'
          const fileB = b.sourceFile || '未知文件'
          return fileA.localeCompare(fileB)
        })
        
        sortedAnswers.forEach(answer => {
          html += createAnswerItemHtml(answer)
        })
        
        html += '</div>'
      }
    })
  }
  
  return html
})

// Create HTML for individual answer item
const createAnswerItemHtml = (answer) => {
  const safeAnswer = (answer.answer || '').replace(/'/g, "\\'").replace(/"/g, '\\"')
  const safeContent = (answer.content || '').replace(/'/g, "\\'").replace(/"/g, '\\"')
  
  let html = `<div class="answer-item">
    <div class="answer-number">${answer.question}</div>
    <div class="answer-option" onclick="copyToClipboard('${safeAnswer}')">
      ${answer.answer}
    </div>`
  
  if (answer.children) {
    html += `<div class="answer-content answer-content-clickable" onclick="toggleChildren(this)">
      点击展开全部回答
    </div>
    <div class="children" style="display: none;">`
    
    answer.children.forEach(child => {
      html += createAnswerItemHtml(child)
    })
    
    html += '</div>'
  } else if (answer.content) {
    html += `<div class="answer-content" onclick="copyToClipboard('${safeContent}')">
      ${answer.content}
    </div>`
  }
  
  if (answer.pattern) {
    html += `<div class="answer-pattern">提取模式: ${answer.pattern}</div>`
  }
  
  if (answer.sourceFile && sortMode.value === 'pattern') {
    html += `<div class="answer-source">来源: ${answer.sourceFile}</div>`
  }
  
  html += `<div class="copy-btn" onclick="copyFullAnswer('${safeAnswer}', '${safeContent}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 4H18C18.5304 4 19.0391 4.21071 19.4142 4.58579C19.7893 4.96086 20 5.46957 20 6V20C20 20.5304 19.7893 21.0391 19.4142 21.4142C19.0391 21.7893 18.5304 22 18 22H6C5.46957 22 4.96086 21.7893 4.58579 21.4142C4.21071 21.0391 4 20.5304 4 20V6C4 5.46957 4.21071 4.96086 4.58579 4.58579C4.96086 4.21071 5.46957 4 6 4H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 2H9C8.44772 2 8 2.44772 8 3V5C8 5.55228 8.44772 6 9 6H15C15.5523 6 16 5.55228 16 5V3C16 2.44772 15.5523 2 15 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> 复制</div>`
  html += '</div>'
  
  return html
}

// Initialize event listeners
const initEventListeners = () => {
  const importInput = document.getElementById('importAnswer')
  const shareBtn = document.getElementById('shareAnswerBtn')
  
  if (importInput) {
    importInput.addEventListener('change', handleFileImport)
  }
  
  if (shareBtn) {
    shareBtn.addEventListener('click', copyCurrentURL)
  }
}

// Handle file import
const handleFileImport = async (event) => {
  const file = event.target.files[0]
  if (file) {
    try {
      // Use the API to parse the file
      const { DatabaseService } = await import('../services/index.js')
      
      if (!DatabaseService) {
        throw new Error('DatabaseService not available')
      }
      
      const result = await DatabaseService.parseAnswerFile(file)
      
      if (result.error) {
        throw new Error(result.error.message || 'Failed to parse file')
      }
      
      // Transform API response to expected format
      const answersData = {
        answers: result.data.answers || [],
        fileName: result.data.fileName,
        fileSize: result.data.fileSize,
        totalAnswers: result.data.totalAnswers,
        parsedAt: result.data.parsedAt
      }
      
      displayAnswers(answersData)
    } catch (error) {
      console.error(error)
      alert('解析答案文件失败: ' + error.message)
    }
    event.target.value = ''
  }
}

// Parse answer file
const parseAnswerFile = async (file) => {
  const text = await readFileAsText(file)
  const filename = file.name.toLowerCase()
  
  if (filename.endsWith('.json')) {
    return parseJsonAnswers(text, file.name)
  } else if (filename.endsWith('.xml')) {
    return parseXmlAnswers(text, file.name)
  } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
    return parseHtmlAnswers(text, file.name)
  } else {
    return parseTextAnswers(text, file.name)
  }
}

// Read file as text
const readFileAsText = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

// Parse JSON answers
const parseJsonAnswers = (text, filename) => {
  try {
    const data = JSON.parse(text)
    
    // Handle Auto366 format
    if (data.answers && Array.isArray(data.answers)) {
      return data.answers.map((answer, index) => ({
        id: index + 1,
        question: answer.question || `题目 ${index + 1}`,
        answer: answer.answer || '',
        content: answer.content || '',
        pattern: answer.pattern || '未知题型',
        sourceFile: answer.sourceFile || filename,
        children: answer.children || null
      }))
    }
    
    const answers = []
    
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        if (typeof item === 'object' && item.question && item.answer) {
          answers.push({
            id: index + 1,
            question: item.question,
            answer: item.answer,
            content: item.content || '',
            pattern: item.pattern || 'JSON题目模式',
            sourceFile: filename
          })
        }
      })
    } else if (typeof data === 'object') {
      Object.entries(data).forEach(([question, answer], index) => {
        answers.push({
          id: index + 1,
          question: question,
          answer: Array.isArray(answer) ? answer.join(', ') : String(answer),
          content: '',
          pattern: 'JSON答案数组模式',
          sourceFile: filename
        })
      })
    }
    
    if (answers.length === 0) {
      throw new Error('JSON文件中未找到有效的问答数据')
    }
    
    return answers
  } catch (err) {
    throw new Error('JSON格式错误：' + err.message)
  }
}

// Parse XML answers
const parseXmlAnswers = (text, filename) => {
  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(text, 'text/xml')
    
    const parseError = xmlDoc.querySelector('parsererror')
    if (parseError) {
      throw new Error('XML格式错误')
    }
    
    const answers = []
    const questions = xmlDoc.querySelectorAll('question, item, qa')
    
    questions.forEach((element, index) => {
      const questionText = element.querySelector('q, question, title')?.textContent?.trim() ||
                          element.getAttribute('question') ||
                          element.getAttribute('q') ||
                          `题目 ${index + 1}`
      
      const answerText = element.querySelector('a, answer, content')?.textContent?.trim() ||
                        element.getAttribute('answer') ||
                        element.getAttribute('a')
      
      if (answerText) {
        answers.push({
          id: index + 1,
          question: questionText,
          answer: answerText,
          content: '',
          pattern: element.getAttribute('type') ? 'XML题目答案模式' : 'XML正确答案模式',
          sourceFile: filename
        })
      }
    })
    
    if (answers.length === 0) {
      throw new Error('XML文件中未找到有效的问答数据')
    }
    
    return answers
  } catch (err) {
    throw new Error('XML解析失败：' + err.message)
  }
}

// Parse HTML answers
const parseHtmlAnswers = (text, filename) => {
  try {
    const parser = new DOMParser()
    const htmlDoc = parser.parseFromString(text, 'text/html')
    const answers = []
    
    const tables = htmlDoc.querySelectorAll('table')
    tables.forEach(table => {
      const rows = table.querySelectorAll('tr')
      rows.forEach((row, index) => {
        const cells = row.querySelectorAll('td, th')
        if (cells.length >= 2) {
          const question = cells[0].textContent?.trim()
          const answer = cells[1].textContent?.trim()
          if (question && answer) {
            answers.push({
              id: answers.length + 1,
              question: question,
              answer: answer,
              content: '',
              pattern: 'HTML表格模式',
              sourceFile: filename
            })
          }
        }
      })
    })
    
    if (answers.length === 0) {
      const elements = htmlDoc.querySelectorAll('div, p, li')
      elements.forEach((element, index) => {
        const text = element.textContent?.trim()
        if (text) {
          const qaMatch = text.match(/(?:Q|问题|题目)[:：]\s*(.+?)(?:A|答案|答)[:：]\s*(.+)/i)
          if (qaMatch) {
            answers.push({
              id: answers.length + 1,
              question: qaMatch[1].trim(),
              answer: qaMatch[2].trim(),
              content: '',
              pattern: 'HTML文本模式',
              sourceFile: filename
            })
          }
        }
      })
    }
    
    if (answers.length === 0) {
      throw new Error('HTML文件中未找到有效的问答数据')
    }
    
    return answers
  } catch (err) {
    throw new Error('HTML解析失败：' + err.message)
  }
}

// Parse text answers
const parseTextAnswers = (text, filename) => {
  const answers = []
  const lines = text.split('\n').map(line => line.trim()).filter(line => line)
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    let qaMatch = line.match(/(?:Q|问题|题目)[:：]\s*(.+?)(?:A|答案|答)[:：]\s*(.+)/i)
    if (qaMatch) {
      answers.push({
        id: answers.length + 1,
        question: qaMatch[1].trim(),
        answer: qaMatch[2].trim(),
        content: '',
        pattern: '文本问答模式',
        sourceFile: filename
      })
      continue
    }
    
    if (line.match(/^(?:\d+[.、]|\*|-)\s*(.+)/)) {
      const question = line.replace(/^(?:\d+[.、]|\*|-)\s*/, '').trim()
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        if (!nextLine.match(/^(?:\d+[.、]|\*|-)/)) {
          answers.push({
            id: answers.length + 1,
            question: question,
            answer: nextLine.trim(),
            content: '',
            pattern: '文本列表模式',
            sourceFile: filename
          })
          i++
          continue
        }
      }
    }
    
    const tabMatch = line.split(/\t+/)
    if (tabMatch.length >= 2) {
      answers.push({
        id: answers.length + 1,
        question: tabMatch[0].trim(),
        answer: tabMatch[1].trim(),
        content: '',
        pattern: '文本制表符模式',
        sourceFile: filename
      })
      continue
    }
    
    const spaceMatch = line.split(/\s{3,}/)
    if (spaceMatch.length >= 2) {
      answers.push({
        id: answers.length + 1,
        question: spaceMatch[0].trim(),
        answer: spaceMatch[1].trim(),
        content: '',
        pattern: '文本空格模式',
        sourceFile: filename
      })
    }
  }
  
  if (answers.length === 0) {
    throw new Error('文本文件中未找到有效的问答数据。支持的格式：\n1. Q: 问题 A: 答案\n2. 编号 问题\\n答案\n3. 问题\\t答案\n4. 问题   答案（多个空格分隔）')
  }
  
  return answers
}

// Display answers
const displayAnswers = (data) => {
  if (!data || !data.answers || data.answers.length === 0) {
    answers.value = []
    return
  }
  
  lastAnswersData.value = data
  answers.value = data.answers
  showShareButton()
}

// Clear answers
const clearAnswers = () => {
  answers.value = []
  lastAnswersData.value = null
  hideShareButton()
  showToast('已清空提取结果')
}

// Show/hide share button
const showShareButton = () => {
  const shareButtonContainer = document.getElementById('shareAnswerButtonContainer')
  if (shareButtonContainer) {
    shareButtonContainer.style.display = 'flex'
  }
}

const hideShareButton = () => {
  const shareButtonContainer = document.getElementById('shareAnswerButtonContainer')
  if (shareButtonContainer) {
    shareButtonContainer.style.display = 'none'
  }
  loadedFromURL.value = false
}

// Copy current URL
const copyCurrentURL = () => {
  const currentURL = window.location.href
  copyToClipboard(currentURL)
  showToast('页面链接已复制到剪贴板！')
}

// Load from URL
const loadFromURL = async () => {
  const url = route.query.url
  if (url) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('网络响应错误')
      }
      const data = await response.json()
      displayAnswers(data)
      loadedFromURL.value = true
    } catch (error) {
      console.error('加载JSON文件失败:', error)
      alert('加载JSON文件失败: ' + error.message)
    }
  }
}

// Global functions for HTML onclick handlers
window.copyToClipboard = (text) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('答案已复制到剪贴板！')
    }).catch(err => {
      console.error('复制失败:', err)
      fallbackCopyToClipboard(text)
    })
  } else {
    fallbackCopyToClipboard(text)
  }
}

window.copyFullAnswer = (answer, content) => {
  const fullAnswer = `${answer}\n${content || ''}`.trim()
  window.copyToClipboard(fullAnswer)
}

window.toggleChildren = (element) => {
  const children = element.nextElementSibling
  if (children && children.classList.contains('children')) {
    if (children.style.display === 'none') {
      children.style.display = 'block'
      element.textContent = '点击收起全部回答'
    } else {
      children.style.display = 'none'
      element.textContent = '点击展开全部回答'
    }
  }
}

// Fallback copy function
const fallbackCopyToClipboard = (text) => {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = 0
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const successful = document.execCommand('copy')
    if (successful) {
      showToast('答案已复制到剪贴板！')
    } else {
      showToast('复制失败，请手动复制', true)
    }
  } catch (err) {
    console.error('复制失败:', err)
    showToast('复制失败，请手动复制', true)
  }
  document.body.removeChild(textarea)
}

// Show toast notification
const showToast = (message, isError = false) => {
  const toast = document.createElement('div')
  toast.className = 'copy-toast show'
  if (isError) {
    toast.classList.add('error')
  }
  toast.textContent = message
  document.body.appendChild(toast)

  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast)
      }
    }, 300)
  }, 2000)
}

// Lifecycle
onMounted(async () => {
  await nextTick()
  initEventListeners()
  loadFromURL()
})
</script>

<style scoped>
.answer-viewer-page {
  padding-top: 80px; /* Account for fixed navigation */
  min-height: 100vh;
  background: #f5f5f5;
  font-family: Arial, sans-serif;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    background: white;
    border-radius: 8px;
    padding: 30px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.answers-display {
    margin: 20px 0;
}

.answers-header {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 15px;
    flex-wrap: wrap;
    gap: 10px;
}

.clear-answers-button {
    display: flex;
    align-items: center;
}

.answers-display h3 {
    color: #495057;
    margin: 0;
}

.sort-mode-selector {
    display: flex;
    align-items: center;
}

.sort-mode-selector label {
    margin-right: 8px;
    font-weight: 500;
    color: #495057;
}

.sort-mode-selector select {
    padding: 6px 10px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    background-color: white;
    color: #495057;
    font-size: 14px;
    cursor: pointer;
}

.sort-mode-selector select:hover {
    border-color: #adb5bd;
}

.answers-container {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 20px;
    border: 1px solid #dee2e6;
    text-align: center;
}

.client-recommend {
    margin: 20px 0;
    padding: 20px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8f9fa;
}

.client-recommend-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.client-recommend-text h3 {
    margin: 0 0 8px 0;
    color: #2d3748;
}

.client-recommend-text p {
    margin: 0;
    color: #4a5568;
}

.client-recommend-btn {
    display: inline-block;
    padding: 10px 18px;
    background: #007bff;
    color: white;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    transition: background 0.2s ease, transform 0.2s ease;
}

.client-recommend-btn:hover {
    background: #0056b3;
    transform: translateY(-1px);
}

.no-answers {
    text-align: center;
    color: #6c757d;
    font-style: italic;
}

/* Deep selectors for dynamically generated content */
.answer-viewer-page :deep(.answer-item) {
    background: white;
    padding: 15px;
    margin: 0 auto 10px;
    border-radius: 6px;
    border-left: 4px solid #007bff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    position: relative;
    max-width: 800px;
    text-align: left;
}

.answer-viewer-page :deep(.answer-item:last-child) {
    margin-bottom: 0;
}

.answer-viewer-page :deep(.answer-number) {
    font-weight: bold;
    color: #007bff;
    font-size: 14px;
}

.answer-viewer-page :deep(.answer-option) {
    display: inline-block;
    background: #007bff;
    color: white;
    padding: 3px 8px;
    border-radius: 12px;
    font-weight: bold;
    margin: 5px 0;
    font-size: 12px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.answer-viewer-page :deep(.answer-option:hover) {
    background: #0056b3;
}

.answer-viewer-page :deep(.answer-content) {
    margin-top: 8px;
    color: #495057;
    line-height: 1.5;
}

.answer-viewer-page :deep(.answer-source) {
    margin-top: 8px;
    color: #6c757d;
    font-size: 12px;
    font-style: italic;
}

.answer-viewer-page :deep(.file-section),
.answer-viewer-page :deep(.pattern-section) {
    margin: 0 auto 25px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    max-width: 800px;
}

.answer-viewer-page :deep(.file-header) {
    background: #f8f9fa;
    padding: 12px 15px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.answer-viewer-page :deep(.file-header h4),
.answer-viewer-page :deep(.pattern-header h4) {
    margin: 0;
    color: #495057;
    font-size: 14px;
    font-weight: 600;
}

.answer-viewer-page :deep(.pattern-header) {
    background: #f8f9fa;
    padding: 12px 15px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.answer-viewer-page :deep(.answer-count) {
    background: #007bff;
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
}

.answer-viewer-page :deep(.file-section .answer-item) {
    margin: 0;
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-top: none;
    border-bottom: 1px solid #f1f3f4;
}

.answer-viewer-page :deep(.file-section .answer-item:last-child) {
    border-bottom: none;
}

.answer-viewer-page :deep(.answer-pattern) {
    margin-top: 5px;
    font-size: 11px;
    color: #6c757d;
    font-style: italic;
    background: #f8f9fa;
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-block;
}

.answer-viewer-page :deep(.copy-btn) {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    transition: background-color 0.2s;
    opacity: 0.8;
}

.answer-viewer-page :deep(.copy-btn:hover) {
    background: #0056b3;
    opacity: 1;
}

.answer-viewer-page :deep(.copy-toast) {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #28a745;
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    font-size: 14px;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.answer-viewer-page :deep(.copy-toast.show) {
    opacity: 1;
}

.answer-viewer-page :deep(.copy-toast.error) {
    background: #dc3545;
}

#importAnswerBtn {
    cursor: pointer;
    background-color: #007bff;
    border-radius: 6px;
    padding: 10px 20px;
    color: white;
    font-size: 14px;
    transition: all 0.3s ease;
    margin-left: 10px;
    display: block;
    width: fit-content;
}

#importAnswerBtn:hover {
    background-color: #0056b3;
}

.share-answer-button {
    display: flex;
    align-items: center;
}

.share-btn {
    cursor: pointer;
    background-color: #28a745;
    border-radius: 6px;
    padding: 10px 20px;
    color: white;
    font-size: 14px;
    border: none;
    transition: all 0.3s ease;
    margin-left: 10px;
    display: block;
    width: fit-content;
}

.share-btn:hover {
    background-color: #218838;
}

.clear-btn {
    padding: 4px 6px;
    background-color: rgba(220, 53, 69, 0.1);
    color: #dc3545;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

.clear-btn:hover {
    background-color: rgba(220, 53, 69, 0.2);
}

.clear-icon {
    width: 20px;
    height: 20px;
}

.clear-icon path {
    fill: currentColor;
}

.file-input-hidden {
    display: none;
}

.answer-viewer-page :deep(.answer-content-clickable) {
    text-align: center;
    color: #007bff;
    font-weight: bold;
    padding: 8px;
    border-radius: 4px;
    background-color: #e6f2ff;
    cursor: pointer;
    transition: all 0.3s ease;
}

.answer-viewer-page :deep(.children) {
    margin-top: 10px;
    padding-left: 20px;
    border-left: 2px solid #e2e8f0;
}

.header {
    text-align: center;
    margin-bottom: 30px;
}

.header-logo {
    width: 87px;
    height: 87px;
    display: block;
    margin: 0 auto 10px;
}

.header-title {
    font-size: 24px;
    font-weight: bold;
    margin: 0;
}

.appreciation-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 20px;
    margin: 30px 0 20px 0;
    flex-wrap: wrap;
}

.appreciation-section {
    text-align: center;
    margin: 0;
}

.appreciation-icon {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: linear-gradient(135deg, #ff6b6b, #ee5a52);
    color: white;
    border-radius: 25px;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
    user-select: none;
}

.appreciation-icon:hover {
    box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4);
    background: linear-gradient(135deg, #ff5252, #e53935);
}

.heart-icon {
    width: 20px;
    height: 20px;
    fill: currentColor;
}

.appreciation-text {
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.5px;
}

.appreciation-popup {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 15px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    padding: 20px;
    min-width: 400px;
    opacity: 0;
    visibility: hidden;
    transition: all 0.3s ease;
    z-index: 1000;
    border: 1px solid #e2e8f0;
}

.appreciation-popup::before {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 8px solid transparent;
    border-top-color: white;
}

.appreciation-icon:hover .appreciation-popup {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(-5px);
}

.appreciation-content h4 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 16px;
    text-align: center;
}

.appreciation-qr-container {
    display: flex;
    gap: 15px;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
}

.appreciation-qr {
    max-width: 180px;
    max-height: 180px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    flex-shrink: 0;
}

@media (max-width: 768px) {
    .answer-viewer-page {
        padding-top: 70px;
    }
    
    .container {
        padding: 15px;
    }

    .answers-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .sort-mode-selector {
        width: 100%;
    }

    .import-answer-button {
        width: 100%;
    }

    .appreciation-wrapper {
        flex-direction: column;
        gap: 15px;
    }
}
</style>