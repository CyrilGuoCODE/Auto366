<template>
  <div class="ruleset-card" @click="handleClick">
    <div class="card-header">
      <div class="card-title">
        <h3>{{ ruleset.name }}</h3>
        <div class="card-badges">
          <span v-if="ruleset.hasInjectionPackage" class="badge badge-injection">
            <IconPackage :size="14" />
            注入包
          </span>
          <span class="badge badge-status" :class="`badge-${ruleset.status}`">
            {{ getStatusText(ruleset.status) }}
          </span>
        </div>
      </div>
    </div>
    
    <div class="card-content">
      <p class="card-description">{{ ruleset.description }}</p>
      
      <div class="card-meta">
        <div class="meta-item">
          <span class="meta-label">作者:</span>
          <span class="meta-value">{{ ruleset.author }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">下载:</span>
          <span class="meta-value">{{ formatDownloadCount(ruleset.downloadCount) }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">大小:</span>
          <span class="meta-value">{{ formatFileSize(ruleset.jsonFileSize) }}</span>
        </div>
      </div>
    </div>
    
    <div class="card-footer">
      <div class="card-date">
        {{ formatDate(ruleset.createdAt) }}
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" @click.stop="$emit('download', ruleset)">
          下载
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconPackage } from './icons/index.js'

const props = defineProps({
  ruleset: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['click', 'download'])

const handleClick = () => {
  emit('click', props.ruleset)
}

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
    month: 'short',
    day: 'numeric'
  })
}
</script>

<style scoped>
.ruleset-card {
  background: var(--background-white);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-large);
  padding: var(--spacing-lg);
  cursor: pointer;
  transition: all var(--transition-base);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ruleset-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--box-shadow-medium);
  transform: translateY(-2px);
}

.card-header {
  margin-bottom: var(--spacing-md);
}

.card-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-sm);
}

.card-title h3 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0;
  line-height: 1.4;
  flex: 1;
}

.card-badges {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  flex-shrink: 0;
}

.badge {
  font-size: var(--font-size-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-small);
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

.card-content {
  flex: 1;
  margin-bottom: var(--spacing-md);
}

.card-description {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: var(--spacing-md);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.meta-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
}

.meta-label {
  color: var(--text-tertiary);
  font-weight: var(--font-weight-medium);
}

.meta-value {
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--border-light);
}

.card-date {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.card-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.btn {
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  border-radius: var(--border-radius);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
}

.btn-sm {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-xs);
}

.btn-primary {
  background-color: var(--primary-color);
  color: var(--text-white);
}

.btn-primary:hover {
  background-color: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
}

/* Responsive design */
@media (max-width: 768px) {
  .ruleset-card {
    padding: var(--spacing-md);
  }
  
  .card-title {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--spacing-sm);
  }
  
  .card-badges {
    flex-direction: row;
    flex-wrap: wrap;
  }
  
  .meta-item {
    font-size: var(--font-size-xs);
  }
  
  .card-footer {
    flex-direction: column;
    gap: var(--spacing-sm);
    align-items: stretch;
  }
  
  .card-actions {
    justify-content: center;
  }
}
</style>