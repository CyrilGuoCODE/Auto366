<template>
  <div class="admin-dashboard">
    <div class="container">
      <!-- Header -->
      <div class="page-header">
        <div class="header-content">
          <div class="header-text">
            <h1>管理后台</h1>
            <p>管理规则集审核和文件操作</p>
          </div>
          <div class="header-actions">
            <button @click="handleLogout" class="logout-button" :disabled="loading">
              退出登录
            </button>
          </div>
        </div>
      </div>

      <!-- Stats Overview -->
      <div class="stats-section">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ pendingCount }}</div>
              <div class="stat-label">待审核</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ approvedCount }}</div>
              <div class="stat-label">已通过</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ totalDownloads }}</div>
              <div class="stat-label">总下载量</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="main-content">
        <!-- Tab Navigation -->
        <div class="tab-navigation">
          <button 
            @click="activeTab = 'pending'" 
            :class="['tab-button', { active: activeTab === 'pending' }]"
          >
            待审核规则集 ({{ pendingCount }})
          </button>
          <button 
            @click="activeTab = 'approved'" 
            :class="['tab-button', { active: activeTab === 'approved' }]"
          >
            已通过规则集 ({{ approvedCount }})
          </button>
          <button 
            @click="activeTab = 'upload'" 
            :class="['tab-button', { active: activeTab === 'upload' }]"
          >
            上传规则集
          </button>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="loading-container">
          <div class="loading-spinner"></div>
          <p>加载中...</p>
        </div>   
     <!-- Pending Rulesets Tab -->
        <div v-else-if="activeTab === 'pending'" class="tab-content">
          <div v-if="pendingRulesets.length === 0" class="empty-state">
            <div class="empty-icon">
              <IconEdit :size="64" />
            </div>
            <h3>暂无待审核规则集</h3>
            <p>所有提交的规则集都已处理完毕</p>
          </div>
          
          <div v-else class="rulesets-grid">
            <div 
              v-for="ruleset in pendingRulesets" 
              :key="ruleset.id" 
              class="ruleset-card pending"
            >
              <div class="card-header">
                <h3 class="ruleset-name">{{ ruleset.name }}</h3>
                <div class="status-badge pending">待审核</div>
              </div>
              
              <div class="card-content">
                <p class="ruleset-description">{{ ruleset.description }}</p>
                <div class="ruleset-meta">
                  <div class="meta-item">
                    <span class="meta-label">作者:</span>
                    <span class="meta-value">{{ ruleset.author }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">提交时间:</span>
                    <span class="meta-value">{{ formatDate(ruleset.createdAt) }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">文件大小:</span>
                    <span class="meta-value">
                      JSON: {{ formatFileSize(ruleset.jsonFileSize) }}
                      <span v-if="ruleset.hasInjectionPackage">
                        | ZIP: {{ formatFileSize(ruleset.zipFileSize) }}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
              
              <div class="card-actions">
                <button 
                  @click="previewRuleset(ruleset)" 
                  class="action-button preview"
                  :disabled="actionLoading[ruleset.id]"
                >
                  预览文件
                </button>
                <button 
                  @click="approveRuleset(ruleset.id)" 
                  class="action-button approve"
                  :disabled="actionLoading[ruleset.id]"
                >
                  <span v-if="actionLoading[ruleset.id]" class="button-spinner"></span>
                  通过
                </button>
                <button 
                  @click="rejectRuleset(ruleset.id)" 
                  class="action-button reject"
                  :disabled="actionLoading[ruleset.id]"
                >
                  拒绝
                </button>
              </div>
            </div>
          </div>
        </div>     
   <!-- Approved Rulesets Tab -->
        <div v-else-if="activeTab === 'approved'" class="tab-content">
          <div v-if="approvedRulesets.length === 0" class="empty-state">
            <div class="empty-icon">
              <IconCheck :size="64" />
            </div>
            <h3>暂无已通过规则集</h3>
            <p>还没有审核通过的规则集</p>
          </div>
          
          <div v-else class="rulesets-grid">
            <div 
              v-for="ruleset in approvedRulesets" 
              :key="ruleset.id" 
              class="ruleset-card approved"
            >
              <div class="card-header">
                <h3 class="ruleset-name">{{ ruleset.name }}</h3>
                <div class="status-badge approved">已通过</div>
              </div>
              
              <div class="card-content">
                <p class="ruleset-description">{{ ruleset.description }}</p>
                <div class="ruleset-meta">
                  <div class="meta-item">
                    <span class="meta-label">作者:</span>
                    <span class="meta-value">{{ ruleset.author }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">下载量:</span>
                    <span class="meta-value">{{ ruleset.downloadCount }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">通过时间:</span>
                    <span class="meta-value">{{ formatDate(ruleset.approvedAt || ruleset.updatedAt) }}</span>
                  </div>
                </div>
              </div>
              
              <div class="card-actions">
                <button 
                  @click="editRuleset(ruleset)" 
                  class="action-button edit"
                  :disabled="actionLoading[ruleset.id]"
                >
                  编辑文件
                </button>
                <button 
                  @click="confirmDelete(ruleset)" 
                  class="action-button delete"
                  :disabled="actionLoading[ruleset.id]"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Upload Ruleset Tab -->
        <div v-else-if="activeTab === 'upload'" class="tab-content">
          <div class="upload-section">
            <div class="upload-header">
              <h2>上传新规则集</h2>
              <p>上传规则集到平台供用户下载使用。上传后的规则集将进入待审核状态。</p>
            </div>
            
            <form @submit.prevent="handleUploadSubmit" class="upload-form">
              <!-- Basic Information -->
              <div class="form-section">
                <h3>基本信息</h3>
                <div class="form-grid">
                  <div class="form-group">
                    <label for="upload-name" class="form-label">
                      规则集名称 <span class="required">*</span>
                    </label>
                    <input
                      id="upload-name"
                      v-model="uploadForm.name"
                      type="text"
                      class="form-input"
                      :class="{ error: uploadErrors.name }"
                      placeholder="请输入规则集名称"
                      maxlength="100"
                    />
                    <div v-if="uploadErrors.name" class="error-text">{{ uploadErrors.name }}</div>
                  </div>
                  
                  <div class="form-group">
                    <label for="upload-author" class="form-label">
                      作者 <span class="required">*</span>
                    </label>
                    <input
                      id="upload-author"
                      v-model="uploadForm.author"
                      type="text"
                      class="form-input"
                      :class="{ error: uploadErrors.author }"
                      placeholder="请输入作者名称"
                      maxlength="50"
                    />
                    <div v-if="uploadErrors.author" class="error-text">{{ uploadErrors.author }}</div>
                  </div>
                </div>
                
                <div class="form-group">
                  <label for="upload-description" class="form-label">
                    描述 <span class="required">*</span>
                  </label>
                  <textarea
                    id="upload-description"
                    v-model="uploadForm.description"
                    class="form-textarea"
                    :class="{ error: uploadErrors.description }"
                    placeholder="请详细描述规则集的功能、适用平台和使用说明"
                    rows="4"
                    maxlength="500"
                  ></textarea>
                  <div class="char-count">{{ uploadForm.description.length }}/500</div>
                  <div v-if="uploadErrors.description" class="error-text">{{ uploadErrors.description }}</div>
                </div>
              </div>
              
              <!-- File Upload -->
              <div class="form-section">
                <h3>文件上传</h3>
                <div class="file-upload-grid">
                  <div class="form-group">
                    <label class="form-label">
                      JSON 规则文件 <span class="required">*</span>
                    </label>
                    <FileUpload
                      v-model="uploadForm.jsonFile"
                      file-type="json"
                      accept=".json"
                      :admin-mode="true"
                      @error="handleFileError"
                      @validate="handleJsonValidation"
                    />
                    <div v-if="uploadErrors.jsonFile" class="error-text">{{ uploadErrors.jsonFile }}</div>
                  </div>
                  
                  <div class="form-group">
                    <label class="form-label">
                      ZIP 注入包 <span class="optional">(可选)</span>
                    </label>
                    <FileUpload
                      v-model="uploadForm.zipFile"
                      file-type="zip"
                      accept=".zip"
                      :admin-mode="true"
                      @error="handleFileError"
                      @validate="handleZipValidation"
                    />
                    <div v-if="uploadErrors.zipFile" class="error-text">{{ uploadErrors.zipFile }}</div>
                  </div>
                </div>
              </div>
              
              <!-- Upload Progress -->
              <div v-if="uploadProgress.show" class="upload-progress">
                <div class="progress-header">
                  <span class="progress-text">{{ uploadProgress.text }}</span>
                  <span class="progress-percentage">{{ uploadProgress.percentage }}%</span>
                </div>
                <div class="progress-bar">
                  <div 
                    class="progress-fill" 
                    :style="{ width: uploadProgress.percentage + '%' }"
                  ></div>
                </div>
              </div>
              
              <!-- Form Actions -->
              <div class="form-actions">
                <button
                  type="button"
                  @click="resetUploadForm"
                  class="form-button secondary"
                  :disabled="uploadLoading"
                >
                  重置表单
                </button>
                <button
                  type="submit"
                  class="form-button primary"
                  :disabled="uploadLoading || !isUploadFormValid"
                >
                  <span v-if="uploadLoading" class="button-spinner"></span>
                  {{ uploadLoading ? '上传中...' : '上传规则集' }}
                </button>
              </div>
            </form>
            
            <!-- Upload Success Message -->
            <div v-if="uploadSuccess" class="success-message">
              <div class="success-icon">
                <IconCheck :size="24" />
              </div>
              <div class="success-content">
                <h4>上传成功！</h4>
                <p>规则集已成功上传，状态为待审核。您可以在"待审核规则集"标签页中查看。</p>
                <button @click="uploadSuccess = false; activeTab = 'pending'" class="success-button">
                  查看待审核列表
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>   
 <!-- File Preview Modal -->
    <div v-if="showPreviewModal" class="modal-overlay" @click="closePreviewModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>文件预览 - {{ previewRulesetData?.name }}</h3>
          <button @click="closePreviewModal" class="close-button">×</button>
        </div>
        <div class="modal-body">
          <div class="file-tabs">
            <button 
              @click="previewTab = 'json'" 
              :class="['tab-button', { active: previewTab === 'json' }]"
            >
              JSON 规则文件
            </button>
            <button 
              v-if="previewRulesetData?.hasInjectionPackage"
              @click="previewTab = 'zip'" 
              :class="['tab-button', { active: previewTab === 'zip' }]"
            >
              ZIP 注入包
            </button>
          </div>
          <div class="file-content">
            <div v-if="previewTab === 'json'" class="json-preview">
              <pre><code>{{ formatJsonPreview(previewRulesetData) }}</code></pre>
            </div>
            <div v-else-if="previewTab === 'zip'" class="zip-preview">
              <div class="zip-info">
                <p>ZIP 注入包包含以下文件:</p>
                <ul>
                  <li>injection.js - 主注入脚本</li>
                  <li>styles.css - 样式文件</li>
                  <li>config.json - 配置文件</li>
                </ul>
                <p class="zip-note">注: ZIP 文件内容无法在此预览，请下载后查看</p>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closePreviewModal" class="modal-button secondary">关闭</button>
        </div>
      </div>
    </div>   
 <!-- Edit Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click="closeEditModal">
      <div class="modal-content large" @click.stop>
        <div class="modal-header">
          <h3>编辑规则集 - {{ editRulesetData?.name }}</h3>
          <button @click="closeEditModal" class="close-button">×</button>
        </div>
        <div class="modal-body">
          <div class="edit-form">
            <div class="form-group">
              <label>规则集名称</label>
              <input 
                v-model="editForm.name" 
                type="text" 
                class="form-input"
                placeholder="请输入规则集名称"
              />
            </div>
            <div class="form-group">
              <label>描述</label>
              <textarea 
                v-model="editForm.description" 
                class="form-textarea"
                rows="3"
                placeholder="请输入规则集描述"
              ></textarea>
            </div>
            <div class="form-group">
              <label>作者</label>
              <input 
                v-model="editForm.author" 
                type="text" 
                class="form-input"
                placeholder="请输入作者名称"
              />
            </div>
            <div class="form-group">
              <label>JSON 规则文件</label>
              <div class="file-upload-area">
                <input 
                  ref="jsonFileInput"
                  type="file" 
                  accept=".json"
                  @change="handleJsonFileChange"
                  class="file-input"
                />
                <div class="file-upload-content">
                  <div class="upload-icon">
                    <IconFile :size="48" />
                  </div>
                  <p>点击选择新的 JSON 文件或保持原文件不变</p>
                  <p class="file-info">当前文件大小: {{ formatFileSize(editRulesetData?.jsonFileSize) }}</p>
                </div>
              </div>
            </div>
            <div v-if="editRulesetData?.hasInjectionPackage" class="form-group">
              <label>ZIP 注入包 (可选)</label>
              <div class="file-upload-area">
                <input 
                  ref="zipFileInput"
                  type="file" 
                  accept=".zip"
                  @change="handleZipFileChange"
                  class="file-input"
                />
                <div class="file-upload-content">
                  <div class="upload-icon">
                    <IconPackage :size="48" />
                  </div>
                  <p>点击选择新的 ZIP 文件或保持原文件不变</p>
                  <p class="file-info">当前文件大小: {{ formatFileSize(editRulesetData?.zipFileSize) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closeEditModal" class="modal-button secondary">取消</button>
          <button @click="saveRulesetChanges" class="modal-button primary" :disabled="editLoading">
            <span v-if="editLoading" class="button-spinner"></span>
            保存更改
          </button>
        </div>
      </div>
    </div>    <!--
 Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click="closeDeleteModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>确认删除</h3>
          <button @click="closeDeleteModal" class="close-button">×</button>
        </div>
        <div class="modal-body">
          <div class="delete-warning">
            <div class="warning-icon">
              <IconWarning :size="48" />
            </div>
            <p>您确定要删除规则集 <strong>{{ deleteRulesetData?.name }}</strong> 吗？</p>
            <p class="warning-text">此操作将永久删除规则集及其所有相关文件，无法恢复。</p>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closeDeleteModal" class="modal-button secondary">取消</button>
          <button @click="confirmDeleteRuleset" class="modal-button danger" :disabled="deleteLoading">
            <span v-if="deleteLoading" class="button-spinner"></span>
            确认删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useRulesetsStore } from '../stores/rulesets.js'
import FileUpload from '../components/FileUpload.vue'
import { IconCheck, IconFile, IconPackage, IconWarning } from '../components/icons/index.js'

const router = useRouter()
const authStore = useAuthStore()
const rulesetsStore = useRulesetsStore()

// State
const loading = ref(false)
const actionLoading = ref({})
const editLoading = ref(false)
const deleteLoading = ref(false)
const activeTab = ref('pending')

// Modal states
const showPreviewModal = ref(false)
const showEditModal = ref(false)
const showDeleteModal = ref(false)
const previewRulesetData = ref(null)
const editRulesetData = ref(null)
const deleteRulesetData = ref(null)
const previewTab = ref('json')

// Edit form
const editForm = ref({
  name: '',
  description: '',
  author: '',
  jsonFile: null,
  zipFile: null
})

// File input refs
const jsonFileInput = ref(null)
const zipFileInput = ref(null)

// Upload form state
const uploadLoading = ref(false)
const uploadSuccess = ref(false)
const uploadForm = ref({
  name: '',
  description: '',
  author: '',
  jsonFile: null,
  zipFile: null
})

const uploadErrors = ref({
  name: '',
  description: '',
  author: '',
  jsonFile: '',
  zipFile: ''
})

const uploadProgress = ref({
  show: false,
  percentage: 0,
  text: '准备上传...'
})

// Computed properties
const pendingRulesets = computed(() => rulesetsStore.pendingRulesets)
const approvedRulesets = computed(() => rulesetsStore.approvedRulesets)

const pendingCount = computed(() => pendingRulesets.value.length)
const approvedCount = computed(() => approvedRulesets.value.length)
const totalDownloads = computed(() => {
  return rulesetsStore.rulesets.reduce((total, ruleset) => {
    return total + (ruleset.downloadCount || 0)
  }, 0)
})

const isUploadFormValid = computed(() => {
  return uploadForm.value.name.trim() &&
         uploadForm.value.description.trim() &&
         uploadForm.value.author.trim() &&
         uploadForm.value.jsonFile &&
         !uploadErrors.value.name &&
         !uploadErrors.value.description &&
         !uploadErrors.value.author &&
         !uploadErrors.value.jsonFile
})

// Methods
const handleLogout = async () => {
  loading.value = true
  try {
    const result = await authStore.logout()
    if (result.success) {
      await router.push('/admin')
    } else {
      console.error('Logout failed:', result.error)
    }
  } catch (error) {
    console.error('Logout error:', error)
  } finally {
    loading.value = false
  }
}

const setActionLoading = (rulesetId, isLoading) => {
  actionLoading.value = { ...actionLoading.value, [rulesetId]: isLoading }
}

const approveRuleset = async (rulesetId) => {
  setActionLoading(rulesetId, true)
  try {
    const result = await rulesetsStore.approveRuleset(rulesetId)
    if (result.success) {
      console.log('Ruleset approved successfully')
    } else {
      console.error('Failed to approve ruleset:', result.error)
      alert('审核通过失败: ' + result.error)
    }
  } catch (error) {
    console.error('Approve ruleset error:', error)
    alert('审核通过时发生错误')
  } finally {
    setActionLoading(rulesetId, false)
  }
}

const rejectRuleset = async (rulesetId) => {
  if (!confirm('确定要拒绝这个规则集吗？')) {
    return
  }
  
  setActionLoading(rulesetId, true)
  try {
    const result = await rulesetsStore.rejectRuleset(rulesetId)
    if (result.success) {
      console.log('Ruleset rejected successfully')
    } else {
      console.error('Failed to reject ruleset:', result.error)
      alert('拒绝失败: ' + result.error)
    }
  } catch (error) {
    console.error('Reject ruleset error:', error)
    alert('拒绝时发生错误')
  } finally {
    setActionLoading(rulesetId, false)
  }
}

const previewRuleset = (ruleset) => {
  previewRulesetData.value = ruleset
  previewTab.value = 'json'
  showPreviewModal.value = true
}

const closePreviewModal = () => {
  showPreviewModal.value = false
  previewRulesetData.value = null
  previewTab.value = 'json'
}

const editRuleset = (ruleset) => {
  editRulesetData.value = ruleset
  editForm.value = {
    name: ruleset.name,
    description: ruleset.description,
    author: ruleset.author,
    jsonFile: null,
    zipFile: null
  }
  showEditModal.value = true
}

const closeEditModal = () => {
  showEditModal.value = false
  editRulesetData.value = null
  editForm.value = {
    name: '',
    description: '',
    author: '',
    jsonFile: null,
    zipFile: null
  }
  if (jsonFileInput.value) jsonFileInput.value.value = ''
  if (zipFileInput.value) zipFileInput.value.value = ''
}

const handleJsonFileChange = (event) => {
  const file = event.target.files[0]
  if (file) {
    if (file.type !== 'application/json') {
      alert('请选择 JSON 文件')
      event.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('文件大小不能超过 5MB')
      event.target.value = ''
      return
    }
    editForm.value.jsonFile = file
  }
}

const handleZipFileChange = (event) => {
  const file = event.target.files[0]
  if (file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('请选择 ZIP 文件')
      event.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('文件大小不能超过 10MB')
      event.target.value = ''
      return
    }
    editForm.value.zipFile = file
  }
}

const saveRulesetChanges = async () => {
  editLoading.value = true
  try {
    if (!editForm.value.name.trim()) {
      alert('请输入规则集名称')
      return
    }
    if (!editForm.value.description.trim()) {
      alert('请输入规则集描述')
      return
    }
    if (!editForm.value.author.trim()) {
      alert('请输入作者名称')
      return
    }

    const updateData = {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim(),
      author: editForm.value.author.trim()
    }

    console.log('Updating ruleset:', editRulesetData.value.id, updateData)
    console.log('JSON file:', editForm.value.jsonFile)
    console.log('ZIP file:', editForm.value.zipFile)

    const ruleset = rulesetsStore.rulesets.find(r => r.id === editRulesetData.value.id)
    if (ruleset) {
      Object.assign(ruleset, updateData)
      ruleset.updatedAt = new Date().toISOString()
    }

    closeEditModal()
    console.log('Ruleset updated successfully')
  } catch (error) {
    console.error('Save changes error:', error)
    alert('保存更改时发生错误')
  } finally {
    editLoading.value = false
  }
}

const confirmDelete = (ruleset) => {
  deleteRulesetData.value = ruleset
  showDeleteModal.value = true
}

const closeDeleteModal = () => {
  showDeleteModal.value = false
  deleteRulesetData.value = null
}

const confirmDeleteRuleset = async () => {
  deleteLoading.value = true
  try {
    const result = await rulesetsStore.deleteRuleset(deleteRulesetData.value.id)
    if (result.success) {
      closeDeleteModal()
      console.log('Ruleset deleted successfully')
    } else {
      console.error('Failed to delete ruleset:', result.error)
      alert('删除失败: ' + result.error)
    }
  } catch (error) {
    console.error('Delete ruleset error:', error)
    alert('删除时发生错误')
  } finally {
    deleteLoading.value = false
  }
}

// Utility functions
const formatDate = (dateString) => {
  if (!dateString) return '未知'
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
}

const formatJsonPreview = (ruleset) => {
  if (!ruleset) return ''
  
  const mockJson = {
    name: ruleset.name,
    version: "1.0.0",
    description: ruleset.description,
    author: ruleset.author,
    rules: [
      {
        selector: ".question-container",
        action: "extract_question",
        condition: "visible"
      },
      {
        selector: ".answer-options input[type='radio']",
        action: "select_answer",
        condition: "matches_answer"
      },
      {
        selector: ".submit-button",
        action: "click",
        condition: "after_selection"
      }
    ],
    settings: {
      delay: 1000,
      retries: 3,
      timeout: 30000,
      auto_submit: true
    },
    metadata: {
      created_at: ruleset.createdAt,
      updated_at: ruleset.updatedAt,
      compatible_platforms: ["智慧树", "超星学习通", "雨课堂"]
    }
  }
  
  return JSON.stringify(mockJson, null, 2)
}

// Upload methods
const validateUploadForm = () => {
  const errors = {
    name: '',
    description: '',
    author: '',
    jsonFile: '',
    zipFile: ''
  }
  
  // Validate name
  if (!uploadForm.value.name.trim()) {
    errors.name = '请输入规则集名称'
  } else if (uploadForm.value.name.trim().length < 2) {
    errors.name = '规则集名称至少需要2个字符'
  }
  
  // Validate author
  if (!uploadForm.value.author.trim()) {
    errors.author = '请输入作者名称'
  } else if (uploadForm.value.author.trim().length < 2) {
    errors.author = '作者名称至少需要2个字符'
  }
  
  // Validate description
  if (!uploadForm.value.description.trim()) {
    errors.description = '请输入规则集描述'
  } else if (uploadForm.value.description.trim().length < 10) {
    errors.description = '描述至少需要10个字符'
  }
  
  // Validate JSON file
  if (!uploadForm.value.jsonFile) {
    errors.jsonFile = '请选择JSON规则文件'
  }
  
  uploadErrors.value = errors
  return !Object.values(errors).some(error => error !== '')
}

const handleUploadSubmit = async () => {
  if (!validateUploadForm()) {
    return
  }
  
  uploadLoading.value = true
  uploadProgress.value = {
    show: true,
    percentage: 0,
    text: '验证文件...'
  }
  
  try {
    // Simulate upload progress
    await simulateUploadProgress()
    
    // Prepare upload data
    const uploadData = {
      name: uploadForm.value.name.trim(),
      description: uploadForm.value.description.trim(),
      author: uploadForm.value.author.trim(),
      jsonFile: uploadForm.value.jsonFile,
      zipFile: uploadForm.value.zipFile
    }
    
    // Upload to store with admin mode enabled
    const result = await rulesetsStore.uploadRuleset(uploadData, true)
    
    if (result.success) {
      uploadSuccess.value = true
      resetUploadForm()
      uploadProgress.value.show = false
      
      // Refresh rulesets to show the new one
      await rulesetsStore.fetchRulesets()
    } else {
      throw new Error(result.error || '上传失败')
    }
    
  } catch (error) {
    console.error('Upload error:', error)
    uploadErrors.value.jsonFile = error.message || '上传失败，请重试'
    uploadProgress.value.show = false
  } finally {
    uploadLoading.value = false
  }
}

const simulateUploadProgress = () => {
  return new Promise((resolve) => {
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5
      if (progress >= 100) {
        progress = 100
        uploadProgress.value.percentage = progress
        uploadProgress.value.text = '上传完成'
        clearInterval(interval)
        resolve()
      } else {
        uploadProgress.value.percentage = Math.floor(progress)
        if (progress < 30) {
          uploadProgress.value.text = '上传文件...'
        } else if (progress < 70) {
          uploadProgress.value.text = '处理文件...'
        } else {
          uploadProgress.value.text = '保存数据...'
        }
      }
    }, 200)
  })
}

const resetUploadForm = () => {
  uploadForm.value = {
    name: '',
    description: '',
    author: '',
    jsonFile: null,
    zipFile: null
  }
  
  uploadErrors.value = {
    name: '',
    description: '',
    author: '',
    jsonFile: '',
    zipFile: ''
  }
  
  uploadSuccess.value = false
  uploadProgress.value = {
    show: false,
    percentage: 0,
    text: '准备上传...'
  }
}

const handleFileError = (error) => {
  console.error('File error:', error)
}

const handleJsonValidation = (result) => {
  if (!result.valid && result.error) {
    uploadErrors.value.jsonFile = result.error
  } else {
    uploadErrors.value.jsonFile = ''
  }
}

const handleZipValidation = (result) => {
  if (!result.valid && result.error) {
    uploadErrors.value.zipFile = result.error
  } else {
    uploadErrors.value.zipFile = ''
  }
}

// Lifecycle
onMounted(async () => {
  console.log('AdminDashboard: Starting to load data')
  loading.value = true
  try {
    // For admin dashboard, use the admin API to get all rulesets including pending ones
    const { DatabaseService } = await import('../services/index.js')
    
    console.log('AdminDashboard: DatabaseService imported')
    
    // Use the admin-specific method to get all rulesets
    const result = await DatabaseService.getAllRulesetsForAdmin('all')
    
    console.log('AdminDashboard: Admin API result:', result)
    
    if (result.error) {
      throw new Error(result.error.message || 'Failed to fetch admin rulesets')
    }
    
    // Transform and set the data
    const transformedRulesets = (result.data || []).map(ruleset => ({
      id: ruleset.id,
      name: ruleset.name,
      description: ruleset.description,
      author: ruleset.author,
      status: ruleset.status,
      downloadCount: ruleset.download_count || 0,
      hasInjectionPackage: ruleset.has_injection_package || false,
      jsonFileSize: ruleset.json_file_size,
      zipFileSize: ruleset.zip_file_size,
      createdAt: ruleset.created_at,
      updatedAt: ruleset.updated_at,
      approvedAt: ruleset.approved_at,
      approvedBy: ruleset.approved_by
    }))
    
    console.log('AdminDashboard: Transformed rulesets:', transformedRulesets)
    console.log('AdminDashboard: Pending rulesets:', transformedRulesets.filter(r => r.status === 'pending'))
    
    rulesetsStore.setRulesets(transformedRulesets)
    
    console.log('AdminDashboard: Store updated, pending count:', pendingCount.value)
  } catch (error) {
    console.error('Failed to load dashboard data:', error)
  } finally {
    loading.value = false
  }
})
</script><style sco
ped>
/* Base styles */
.admin-dashboard {
  padding-top: 80px;
  min-height: 100vh;
  background: #f8fafc;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

/* Header */
.page-header {
  padding: 2rem 0;
  margin-bottom: 2rem;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}

.header-text h1 {
  font-size: 2.5rem;
  color: #2563eb;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.header-text p {
  font-size: 1rem;
  color: #64748b;
}

.logout-button {
  background: #ef4444;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.logout-button:hover:not(:disabled) {
  background: #dc2626;
}

.logout-button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

/* Stats Section */
.stats-section {
  margin-bottom: 2rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.stat-card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-icon {
  font-size: 2rem;
}

.stat-content {
  flex: 1;
}

.stat-number {
  font-size: 2rem;
  font-weight: 700;
  color: #2563eb;
  line-height: 1;
}

.stat-label {
  font-size: 0.875rem;
  color: #64748b;
  margin-top: 0.25rem;
}

/* Tab Navigation */
.tab-navigation {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2rem;
  border-bottom: 1px solid #e2e8f0;
}

.tab-button {
  background: none;
  border: none;
  padding: 1rem 1.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: #2563eb;
}

.tab-button.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
}

/* Loading */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 0;
  gap: 1rem;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top: 3px solid #2563eb;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 4rem 2rem;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.empty-state h3 {
  font-size: 1.5rem;
  color: #374151;
  margin-bottom: 0.5rem;
}

.empty-state p {
  color: #64748b;
  font-size: 1rem;
}

/* Rulesets Grid */
.rulesets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 1.5rem;
}

.ruleset-card {
  background: white;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}

.ruleset-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.ruleset-card.pending {
  border-left: 4px solid #f59e0b;
}

.ruleset-card.approved {
  border-left: 4px solid #10b981;
}

.card-header {
  padding: 1.5rem 1.5rem 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.ruleset-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: #374151;
  margin: 0;
  line-height: 1.3;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.status-badge.pending {
  background: #fef3c7;
  color: #92400e;
}

.status-badge.approved {
  background: #d1fae5;
  color: #065f46;
}

.card-content {
  padding: 0 1.5rem 1rem 1.5rem;
}

.ruleset-description {
  color: #64748b;
  line-height: 1.5;
  margin-bottom: 1rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ruleset-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.meta-item {
  display: flex;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.meta-label {
  color: #64748b;
  font-weight: 500;
  min-width: 80px;
}

.meta-value {
  color: #374151;
}

.card-actions {
  padding: 1rem 1.5rem;
  border-top: 1px solid #f1f5f9;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.action-button {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-button.preview {
  background: #f8fafc;
  color: #475569;
  border-color: #cbd5e1;
}

.action-button.preview:hover:not(:disabled) {
  background: #e2e8f0;
}

.action-button.approve {
  background: #10b981;
  color: white;
  border-color: #10b981;
}

.action-button.approve:hover:not(:disabled) {
  background: #059669;
}

.action-button.reject {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.action-button.reject:hover:not(:disabled) {
  background: #dc2626;
}

.action-button.edit {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.action-button.edit:hover:not(:disabled) {
  background: #2563eb;
}

.action-button.delete {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.action-button.delete:hover:not(:disabled) {
  background: #dc2626;
}

.button-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}/*
 Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: white;
  border-radius: 8px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-content.large {
  max-width: 800px;
}

.modal-header {
  padding: 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #374151;
  margin: 0;
}

.close-button {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: #64748b;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
}

.close-button:hover {
  color: #374151;
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 1.5rem;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.modal-button {
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-button.primary {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.modal-button.primary:hover:not(:disabled) {
  background: #2563eb;
}

.modal-button.secondary {
  background: #f8fafc;
  color: #475569;
  border-color: #cbd5e1;
}

.modal-button.secondary:hover:not(:disabled) {
  background: #e2e8f0;
}

.modal-button.danger {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.modal-button.danger:hover:not(:disabled) {
  background: #dc2626;
}

.modal-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* File Preview */
.file-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #e2e8f0;
}

.file-content {
  max-height: 400px;
  overflow-y: auto;
}

.json-preview pre {
  background: #f8fafc;
  padding: 1rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  font-size: 0.875rem;
  line-height: 1.5;
  overflow-x: auto;
  margin: 0;
}

.json-preview code {
  color: #374151;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

/* Upload Form Styles */
.upload-section {
  max-width: 800px;
  margin: 0 auto;
}

.upload-header {
  text-align: center;
  margin-bottom: 2rem;
}

.upload-header h2 {
  font-size: 1.875rem;
  color: #2563eb;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.upload-header p {
  color: #64748b;
  font-size: 1rem;
  line-height: 1.6;
}

.upload-form {
  background: white;
  border-radius: 12px;
  padding: 2rem;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.form-section {
  margin-bottom: 2rem;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-section h3 {
  font-size: 1.25rem;
  color: #374151;
  margin-bottom: 1.5rem;
  font-weight: 600;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #e2e8f0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.file-upload-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.required {
  color: #ef4444;
}

.optional {
  color: #64748b;
  font-weight: 400;
}

.form-input,
.form-textarea {
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.875rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  background: white;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-input.error,
.form-textarea.error {
  border-color: #ef4444;
}

.form-textarea {
  resize: vertical;
  min-height: 100px;
}

.char-count {
  font-size: 0.75rem;
  color: #64748b;
  text-align: right;
  margin-top: -0.25rem;
}

.error-text {
  font-size: 0.75rem;
  color: #ef4444;
  font-weight: 500;
}

.upload-progress {
  margin: 1.5rem 0;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.progress-text {
  font-size: 0.875rem;
  color: #374151;
  font-weight: 500;
}

.progress-percentage {
  font-size: 0.875rem;
  color: #2563eb;
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #1d4ed8);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
}

.form-button {
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 120px;
  justify-content: center;
}

.form-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-button.primary {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.form-button.primary:hover:not(:disabled) {
  background: #2563eb;
  border-color: #2563eb;
}

.form-button.secondary {
  background: #f8fafc;
  color: #475569;
  border-color: #cbd5e1;
}

.form-button.secondary:hover:not(:disabled) {
  background: #e2e8f0;
}

.success-message {
  margin-top: 2rem;
  padding: 2rem;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.success-icon {
  font-size: 2rem;
  flex-shrink: 0;
}

.success-content {
  flex: 1;
}

.success-content h4 {
  font-size: 1.125rem;
  color: #166534;
  margin: 0 0 0.5rem 0;
  font-weight: 600;
}

.success-content p {
  color: #166534;
  margin: 0 0 1rem 0;
  line-height: 1.5;
}

.success-button {
  background: #16a34a;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.success-button:hover {
  background: #15803d;
}

/* Responsive Design */
@media (max-width: 768px) {
  .upload-form {
    padding: 1.5rem;
  }
  
  .form-grid,
  .file-upload-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .form-actions {
    flex-direction: column;
  }
  
  .form-button {
    width: 100%;
  }
  
  .success-message {
    flex-direction: column;
    text-align: center;
  }
}

.zip-preview {
  background: #f8fafc;
  padding: 1.5rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.zip-info p {
  margin-bottom: 1rem;
  color: #374151;
}

.zip-info ul {
  margin: 1rem 0;
  padding-left: 1.5rem;
}

.zip-info li {
  color: #64748b;
  margin-bottom: 0.5rem;
}

.zip-note {
  font-style: italic;
  color: #64748b;
  font-size: 0.875rem;
}

/* Edit Form */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 500;
  color: #374151;
  font-size: 0.875rem;
}

.form-input,
.form-textarea {
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.2s ease;
  background: white;
  color: #374151;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.file-upload-area {
  position: relative;
  border: 2px dashed #cbd5e1;
  border-radius: 6px;
  padding: 2rem;
  text-align: center;
  transition: border-color 0.2s ease;
  cursor: pointer;
}

.file-upload-area:hover {
  border-color: #3b82f6;
}

.file-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.file-upload-content {
  pointer-events: none;
}

.upload-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.file-upload-content p {
  color: #64748b;
  margin-bottom: 0.5rem;
}

.file-info {
  font-size: 0.875rem;
  color: #9ca3af;
}

/* Delete Warning */
.delete-warning {
  text-align: center;
  padding: 1rem 0;
}

.warning-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.delete-warning p {
  margin-bottom: 0.5rem;
  color: #374151;
}

.warning-text {
  color: #ef4444;
  font-size: 0.875rem;
}

/* Responsive Design */
@media (max-width: 768px) {
  .admin-dashboard {
    padding-top: 60px;
  }
  
  .header-content {
    flex-direction: column;
    align-items: stretch;
  }
  
  .header-text {
    text-align: center;
  }
  
  .header-text h1 {
    font-size: 2rem;
  }
  
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .rulesets-grid {
    grid-template-columns: 1fr;
  }
  
  .card-actions {
    flex-direction: column;
  }
  
  .action-button {
    justify-content: center;
  }
  
  .tab-navigation {
    flex-direction: column;
    gap: 0;
  }
  
  .tab-button {
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
    border-radius: 0;
  }
  
  .tab-button.active {
    border-bottom-color: #e2e8f0;
    background: #f8fafc;
  }
  
  .modal-content {
    margin: 0.5rem;
    max-height: calc(100vh - 1rem);
  }
  
  .modal-footer {
    flex-direction: column;
  }
  
  .file-tabs {
    flex-direction: column;
    gap: 0;
  }
}

@media (max-width: 480px) {
  .container {
    padding: 0 0.5rem;
  }
  
  .page-header {
    padding: 1rem 0;
  }
  
  .stat-card {
    padding: 1rem;
  }
  
  .stat-number {
    font-size: 1.5rem;
  }
  
  .ruleset-card {
    margin: 0 -0.5rem;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  
  .card-header,
  .card-content,
  .card-actions {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}
</style>