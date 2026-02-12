<template>
  <div class="ruleset-detail">
    <div class="container">
      <!-- Navigation breadcrumb -->
      <div class="breadcrumb">
        <router-link to="/rulesets" class="breadcrumb-link">
          ← 返回规则集列表
        </router-link>
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="loading-container">
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="error-container">
        <div class="error-card">
          <h3>
            <IconX :size="20" />
            加载失败
          </h3>
          <p>{{ error }}</p>
          <button @click="loadRuleset" class="btn btn-primary">重试</button>
        </div>
      </div>

      <!-- Main content -->
      <div v-else-if="ruleset" class="detail-content">
        <!-- Header section -->
        <div class="detail-header">
          <div class="header-main">
            <h1 class="ruleset-title">{{ ruleset.name }}</h1>
            <div class="header-badges">
              <span v-if="ruleset.hasInjectionPackage" class="badge badge-injection">
                <IconPackage :size="16" />
                包含注入包
              </span>
              <span class="badge badge-status" :class="`badge-${ruleset.status}`">
                {{ getStatusText(ruleset.status) }}
              </span>
            </div>
          </div>
          <div class="header-actions">
            <button @click="shareRuleset" class="btn btn-secondary" :disabled="shareLoading">
              <span v-if="shareLoading">分享中...</span>
              <span v-else-if="shareSuccess">
                <IconCheck :size="16" />
                已复制
              </span>
              <span v-else>
                <IconLink :size="16" />
                分享
              </span>
            </button>
          </div>
        </div>

        <!-- Basic information -->
        <div class="info-section">
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">作者</span>
              <span class="info-value">{{ ruleset.author }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">下载次数</span>
              <span class="info-value">{{ formatDownloadCount(ruleset.downloadCount) }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">文件大小</span>
              <span class="info-value">{{ formatFileSize(totalFileSize) }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">上传时间</span>
              <span class="info-value">{{ formatDate(ruleset.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Description -->
        <div class="description-section">
          <h2>规则集描述</h2>
          <p class="description-text">{{ ruleset.description }}</p>
        </div>

        <!-- File composition -->
        <div class="files-section">
          <h2>文件组成</h2>
          <div class="files-grid">
            <!-- JSON file -->
            <div class="file-card">
              <div class="file-header">
                <div class="file-icon">
                  <IconFile :size="32" />
                </div>
                <div class="file-info">
                  <h3>JSON 规则文件</h3>
                  <p class="file-size">{{ formatFileSize(ruleset.jsonFileSize) }}</p>
                </div>
              </div>
              <div class="file-actions">
                <button @click="downloadJson" class="btn btn-primary" :disabled="downloadingJson">
                  <span v-if="downloadingJson">下载中...</span>
                  <span v-else>下载 JSON</span>
                </button>
              </div>
            </div>

            <!-- ZIP file -->
            <div v-if="ruleset.hasInjectionPackage" class="file-card">
              <div class="file-header">
                <div class="file-icon">
                  <IconPackage :size="32" />
                </div>
                <div class="file-info">
                  <h3>ZIP 注入包</h3>
                  <p class="file-size">{{ formatFileSize(ruleset.zipFileSize) }}</p>
                </div>
              </div>
              <div class="file-actions">
                <button @click="downloadZip" class="btn btn-primary" :disabled="downloadingZip">
                  <span v-if="downloadingZip">下载中...</span>
                  <span v-else>下载 ZIP</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useRulesetsStore } from '../stores/rulesets.js'
import { IconX, IconPackage, IconCheck, IconLink, IconFile } from '../components/icons/index.js'

const route = useRoute()
const rulesetsStore = useRulesetsStore()

// Reactive state
const loading = ref(true)
const error = ref(null)
const downloadingJson = ref(false)
const downloadingZip = ref(false)
const shareLoading = ref(false)
const shareSuccess = ref(false)

// Computed properties
const ruleset = computed(() => rulesetsStore.currentRuleset)

// Calculate total file size (JSON + ZIP if exists)
const totalFileSize = computed(() => {
  if (!ruleset.value) return 0
  
  let total = ruleset.value.jsonFileSize || 0
  if (ruleset.value.hasInjectionPackage && ruleset.value.zipFileSize) {
    total += ruleset.value.zipFileSize
  }
  
  return total
})

// Methods
const loadRuleset = async () => {
  loading.value = true
  error.value = null
  
  try {
    const result = await rulesetsStore.fetchRulesetById(route.params.id)
    if (!result.success) {
      error.value = result.error || '加载规则集失败'
    }
  } catch (err) {
    error.value = '网络错误，请检查连接'
    console.error('Load ruleset error:', err)
  } finally {
    loading.value = false
  }
}

const downloadJson = async () => {
  if (!ruleset.value) return
  
  downloadingJson.value = true
  
  try {
    // Import DatabaseService dynamically to avoid circular dependencies
    const { DatabaseService } = await import('../services/index.js')
    
    if (!DatabaseService) {
      throw new Error('DatabaseService not available')
    }
    
    console.log('Downloading JSON for ruleset:', ruleset.value.id)
    
    // Get download URL from API
    const result = await DatabaseService.getDownloadUrl(ruleset.value.id, 'json')
    
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get download URL')
    }
    
    // Create download link
    const a = document.createElement('a')
    a.href = result.data.downloadUrl
    a.download = result.data.fileName || `${ruleset.value.name}.json`
    a.target = '_blank'
    
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    
    // Update download count locally
    ruleset.value.downloadCount++
  } catch (err) {
    console.error('Download JSON error:', err)
    alert('下载失败：' + err.message)
  } finally {
    downloadingJson.value = false
  }
}

const downloadZip = async () => {
  if (!ruleset.value || !ruleset.value.hasInjectionPackage) return
  
  downloadingZip.value = true
  
  try {
    // Import DatabaseService dynamically to avoid circular dependencies
    const { DatabaseService } = await import('../services/index.js')
    
    if (!DatabaseService) {
      throw new Error('DatabaseService not available')
    }
    
    console.log('Downloading ZIP for ruleset:', ruleset.value.id)
    
    // Get download URL from API
    const result = await DatabaseService.getDownloadUrl(ruleset.value.id, 'zip')
    
    if (result.error) {
      throw new Error(result.error.message || 'Failed to get download URL')
    }
    
    // Create download link
    const a = document.createElement('a')
    a.href = result.data.downloadUrl
    a.download = result.data.fileName || `${ruleset.value.name}-injection.zip`
    a.target = '_blank'
    
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    
    // Update download count locally
    ruleset.value.downloadCount++
  } catch (err) {
    console.error('Download ZIP error:', err)
    alert('下载失败：' + err.message)
  } finally {
    downloadingZip.value = false
  }
}

const shareRuleset = async () => {
  if (!ruleset.value) return
  
  shareLoading.value = true
  shareSuccess.value = false
  
  try {
    const url = window.location.href
    
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url)
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = url
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    
    shareSuccess.value = true
    setTimeout(() => {
      shareSuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('Share error:', err)
    alert('分享失败，请手动复制链接')
  } finally {
    shareLoading.value = false
  }
}

// Utility functions
const getStatusText = (status) => {
  const statusMap = {
    'approved': '已审核',
    'pending': '待审核',
    'rejected': '已拒绝'
  }
  return statusMap[status] || status
}

const formatDownloadCount = (count) => {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`
  }
  return count.toString()
}

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B'
  
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

const formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Lifecycle
onMounted(() => {
  loadRuleset()
})
</script>

<style scoped>
.ruleset-detail {
  padding-top: 80px;
  min-height: 100vh;
  background-color: var(--background-color);
}

.container {
  max-width: 1000px;
}

/* Breadcrumb */
.breadcrumb {
  margin-bottom: var(--spacing-lg);
}

.breadcrumb-link {
  display: inline-flex;
  align-items: center;
  color: var(--primary-color);
  text-decoration: none;
  font-weight: var(--font-weight-medium);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--primary-color);
  border-radius: var(--border-radius);
  transition: all var(--transition-base);
}

.breadcrumb-link:hover {
  background-color: var(--primary-color);
  color: var(--text-white);
}

/* Loading state */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: var(--spacing-md);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-light);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Error state */
.error-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.error-card {
  background: var(--background-white);
  padding: var(--spacing-xl);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-medium);
  text-align: center;
  max-width: 400px;
}

.error-card h3 {
  font-size: var(--font-size-xl);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
}

.error-card p {
  color: var(--text-secondary);
  margin-bottom: var(--spacing-lg);
  line-height: 1.6;
}

/* Main content */
.detail-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

/* Header section */
.detail-header {
  background: var(--background-white);
  padding: var(--spacing-xl);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-lg);
}

.header-main {
  flex: 1;
}

.ruleset-title {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
  line-height: 1.2;
}

.header-badges {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.badge {
  font-size: var(--font-size-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.badge-injection {
  background-color: #e6f7ff;
  color: var(--primary-color);
  border: 1px solid #91d5ff;
}

.badge-approved {
  background-color: #f6ffed;
  color: var(--success-color);
  border: 1px solid #b7eb8f;
}

.badge-pending {
  background-color: #fffbe6;
  color: var(--warning-color);
  border: 1px solid #ffe58f;
}

.badge-rejected {
  background-color: #fff2f0;
  color: var(--error-color);
  border: 1px solid #ffccc7;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* Info section */
.info-section {
  background: var(--background-white);
  padding: var(--spacing-xl);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-lg);
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.info-label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  font-weight: var(--font-weight-medium);
}

.info-value {
  font-size: var(--font-size-lg);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}

/* Description section */
.description-section {
  background: var(--background-white);
  padding: var(--spacing-xl);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
}

.description-section h2 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
}

.description-text {
  color: var(--text-secondary);
  line-height: 1.7;
  font-size: var(--font-size-base);
}

/* Files section */
.files-section {
  background: var(--background-white);
  padding: var(--spacing-xl);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
}

.files-section h2 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-lg);
}

.files-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--spacing-lg);
}

.file-card {
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  padding: var(--spacing-lg);
  transition: all var(--transition-base);
}

.file-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--box-shadow-light);
}

.file-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.file-icon {
  font-size: var(--font-size-3xl);
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--background-light);
  border-radius: var(--border-radius);
}

.file-info h3 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-xs);
}

.file-size {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.file-actions {
  display: flex;
  justify-content: center;
}

/* Buttons */
.btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  border-radius: var(--border-radius);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-base);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  min-width: 120px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-sm);
  min-width: auto;
}

.btn-primary {
  background-color: var(--primary-color);
  color: var(--text-white);
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-secondary {
  background-color: var(--background-white);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

/* Responsive design */
@media (max-width: 768px) {
  .ruleset-detail {
    padding-top: 60px;
  }
  
  .container {
    padding: 0 var(--spacing-sm);
  }
  
  .detail-header {
    flex-direction: column;
    align-items: stretch;
    gap: var(--spacing-md);
  }
  
  .header-actions {
    justify-content: center;
  }
  
  .ruleset-title {
    font-size: var(--font-size-2xl);
  }
  
  .info-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }
  
  .files-grid {
    grid-template-columns: 1fr;
  }
  
}

@media (max-width: 480px) {
  .detail-content {
    gap: var(--spacing-lg);
  }
  
  .detail-header,
  .info-section,
  .description-section,
  .files-section {
    padding: var(--spacing-lg);
  }
  
  .file-header {
    flex-direction: column;
    text-align: center;
  }
  
  .file-icon {
    width: 50px;
    height: 50px;
    font-size: var(--font-size-2xl);
  }
}
</style>