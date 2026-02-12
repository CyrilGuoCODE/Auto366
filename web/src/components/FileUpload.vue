<template>
  <div class="file-upload">
    <div 
      class="upload-area"
      :class="{ 
        'drag-over': isDragOver, 
        'has-file': hasFile,
        'error': hasError 
      }"
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @click="triggerFileInput"
    >
      <input
        ref="fileInput"
        type="file"
        :accept="accept"
        @change="handleFileSelect"
        class="file-input"
      />
      
      <div class="upload-content">
        <div v-if="!hasFile" class="upload-placeholder">
          <div class="upload-icon">
            <component :is="icon" :size="32" />
          </div>
          <div class="upload-text">
            <p class="primary-text">{{ primaryText }}</p>
            <p class="secondary-text">{{ secondaryText }}</p>
          </div>
        </div>
        
        <div v-else class="file-info">
          <div class="file-icon">
            <component :is="fileIcon" :size="24" />
          </div>
          <div class="file-details">
            <p class="file-name">{{ file.name }}</p>
            <p class="file-size">{{ formatFileSize(file.size) }}</p>
          </div>
          <button 
            @click.stop="removeFile" 
            class="remove-button"
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      
      <div v-if="hasError" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
    
    <div v-if="validationRules.length > 0" class="validation-info">
      <p class="validation-title">文件要求:</p>
      <ul class="validation-list">
        <li v-for="rule in validationRules" :key="rule">{{ rule }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { IconFile, IconPackage } from './icons/index.js'

const props = defineProps({
  accept: {
    type: String,
    default: '*'
  },
  maxSize: {
    type: Number,
    default: 10 * 1024 * 1024 // 10MB
  },
  fileType: {
    type: String,
    required: true,
    validator: (value) => ['json', 'zip'].includes(value)
  },
  modelValue: {
    type: File,
    default: null
  },
  required: {
    type: Boolean,
    default: false
  },
  adminMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'error', 'validate'])

// State
const fileInput = ref(null)
const isDragOver = ref(false)
const file = ref(props.modelValue)
const errorMessage = ref('')

// Computed
const hasFile = computed(() => file.value !== null)
const hasError = computed(() => errorMessage.value !== '')

const icon = computed(() => {
  return props.fileType === 'json' ? IconFile : IconPackage
})

const fileIcon = computed(() => {
  if (!file.value) return null
  return props.fileType === 'json' ? IconFile : IconPackage
})

const primaryText = computed(() => {
  return props.fileType === 'json' 
    ? '点击选择 JSON 文件或拖拽到此处' 
    : '点击选择 ZIP 文件或拖拽到此处'
})

const secondaryText = computed(() => {
  if (props.adminMode) {
    return '管理员模式：无文件大小限制，支持拖拽上传'
  }
  const maxSizeMB = Math.round(props.maxSize / (1024 * 1024))
  return `支持拖拽上传，最大 ${maxSizeMB}MB`
})

const validationRules = computed(() => {
  const rules = []
  if (props.fileType === 'json') {
    rules.push('仅支持 .json 格式文件')
    if (!props.adminMode) {
      rules.push('文件必须是有效的 JSON 格式')
    }
  } else if (props.fileType === 'zip') {
    rules.push('仅支持 .zip 格式文件')
    if (!props.adminMode) {
      rules.push('ZIP 文件应包含注入脚本')
    }
  }
  
  if (props.adminMode) {
    rules.push('管理员模式：无文件大小和内容限制')
  } else {
    const maxSizeMB = Math.round(props.maxSize / (1024 * 1024))
    rules.push(`文件大小不超过 ${maxSizeMB}MB`)
  }
  
  return rules
})

// Methods
const triggerFileInput = () => {
  fileInput.value?.click()
}

const handleFileSelect = (event) => {
  const selectedFile = event.target.files[0]
  if (selectedFile) {
    validateAndSetFile(selectedFile)
  }
}

const handleDrop = (event) => {
  event.preventDefault()
  isDragOver.value = false
  
  const droppedFile = event.dataTransfer.files[0]
  if (droppedFile) {
    validateAndSetFile(droppedFile)
  }
}

const handleDragOver = (event) => {
  event.preventDefault()
  isDragOver.value = true
}

const handleDragEnter = (event) => {
  event.preventDefault()
  isDragOver.value = true
}

const handleDragLeave = (event) => {
  event.preventDefault()
  // Only set to false if we're leaving the upload area entirely
  if (!event.currentTarget.contains(event.relatedTarget)) {
    isDragOver.value = false
  }
}

const validateAndSetFile = async (selectedFile) => {
  errorMessage.value = ''
  
  try {
    // Validate file type
    if (props.fileType === 'json' && !selectedFile.name.toLowerCase().endsWith('.json')) {
      throw new Error('请选择 JSON 文件')
    }
    
    if (props.fileType === 'zip' && !selectedFile.name.toLowerCase().endsWith('.zip')) {
      throw new Error('请选择 ZIP 文件')
    }
    
    // Skip size and content validation for admin mode
    if (!props.adminMode) {
      // Validate file size
      if (selectedFile.size > props.maxSize) {
        const maxSizeMB = Math.round(props.maxSize / (1024 * 1024))
        throw new Error(`文件大小不能超过 ${maxSizeMB}MB`)
      }
      
      // Additional JSON validation
      if (props.fileType === 'json') {
        await validateJsonFile(selectedFile)
      }
    }
    
    // Set file if validation passes
    file.value = selectedFile
    emit('update:modelValue', selectedFile)
    emit('validate', { valid: true, file: selectedFile })
    
  } catch (error) {
    errorMessage.value = error.message
    file.value = null
    emit('update:modelValue', null)
    emit('error', error.message)
    emit('validate', { valid: false, error: error.message })
  }
}

const validateJsonFile = (jsonFile) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const content = e.target.result
        const parsed = JSON.parse(content)
        
        // Basic structure validation for ruleset JSON
        if (!parsed.name || typeof parsed.name !== 'string') {
          reject(new Error('JSON 文件必须包含有效的 name 字段'))
          return
        }
        
        if (!parsed.rules || !Array.isArray(parsed.rules)) {
          reject(new Error('JSON 文件必须包含 rules 数组'))
          return
        }
        
        resolve(parsed)
      } catch (error) {
        reject(new Error('无效的 JSON 格式'))
      }
    }
    
    reader.onerror = () => {
      reject(new Error('文件读取失败'))
    }
    
    reader.readAsText(jsonFile)
  })
}

const removeFile = () => {
  file.value = null
  errorMessage.value = ''
  emit('update:modelValue', null)
  emit('validate', { valid: true, file: null })
  
  // Clear file input
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Watch for external changes to modelValue
watch(() => props.modelValue, (newValue) => {
  file.value = newValue
})
</script>

<style scoped>
.file-upload {
  width: 100%;
}

.upload-area {
  border: 2px dashed #cbd5e1;
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #f8fafc;
  position: relative;
}

.upload-area:hover {
  border-color: #3b82f6;
  background: #f1f5f9;
}

.upload-area.drag-over {
  border-color: #3b82f6;
  background: #eff6ff;
  transform: scale(1.02);
}

.upload-area.has-file {
  border-color: #10b981;
  background: #f0fdf4;
}

.upload-area.error {
  border-color: #ef4444;
  background: #fef2f2;
}

.file-input {
  display: none;
}

.upload-content {
  position: relative;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.upload-icon {
  font-size: 3rem;
  opacity: 0.7;
}

.upload-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.primary-text {
  font-size: 1rem;
  font-weight: 500;
  color: #374151;
  margin: 0;
}

.secondary-text {
  font-size: 0.875rem;
  color: #64748b;
  margin: 0;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: white;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.file-icon {
  font-size: 2rem;
}

.file-details {
  flex: 1;
  text-align: left;
}

.file-name {
  font-weight: 500;
  color: #374151;
  margin: 0 0 0.25rem 0;
  word-break: break-all;
}

.file-size {
  font-size: 0.875rem;
  color: #64748b;
  margin: 0;
}

.remove-button {
  background: #ef4444;
  color: white;
  border: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.remove-button:hover {
  background: #dc2626;
}

.error-message {
  color: #ef4444;
  font-size: 0.875rem;
  margin-top: 0.5rem;
  font-weight: 500;
}

.validation-info {
  margin-top: 1rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.validation-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
  margin: 0 0 0.5rem 0;
}

.validation-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #64748b;
}

.validation-list li {
  margin-bottom: 0.25rem;
}

.validation-list li:last-child {
  margin-bottom: 0;
}

/* Responsive design */
@media (max-width: 640px) {
  .upload-area {
    padding: 1.5rem 1rem;
  }
  
  .upload-icon {
    font-size: 2.5rem;
  }
  
  .primary-text {
    font-size: 0.875rem;
  }
  
  .secondary-text {
    font-size: 0.75rem;
  }
  
  .file-info {
    flex-direction: column;
    text-align: center;
    gap: 0.75rem;
  }
  
  .file-details {
    text-align: center;
  }
}
</style>