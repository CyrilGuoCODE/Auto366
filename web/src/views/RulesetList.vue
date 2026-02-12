<template>
  <div class="ruleset-list">
    <div class="container">
      <div class="page-header">
        <h1>社区规则集</h1>
        <p>浏览和下载社区贡献的规则集</p>
      </div>
      
      <!-- Search and Filter Controls -->
      <div class="controls-section">
        <div class="search-bar">
          <div class="search-input-wrapper">
            <input
              v-model="rulesetsStore.searchQuery"
              type="text"
              placeholder="搜索规则集名称、作者或描述..."
              class="search-input"
              @input="handleSearch"
            />
            <div class="search-icon">
              <IconSearch :size="20" />
            </div>
          </div>
        </div>
        
        <div class="filter-controls">
          <div class="sort-control">
            <label for="sort-select">排序:</label>
            <select
              id="sort-select"
              v-model="rulesetsStore.sortBy"
              class="sort-select"
              @change="handleSortChange"
            >
              <option value="latest">最新上传</option>
              <option value="downloads">下载量</option>
              <option value="name">名称</option>
            </select>
          </div>
          
          <div class="status-filter" v-if="showStatusFilter">
            <label for="status-select">状态:</label>
            <select
              id="status-select"
              v-model="rulesetsStore.filterStatus"
              class="status-select"
              @change="handleStatusChange"
            >
              <option value="approved">已审核</option>
              <option value="all">全部</option>
              <option value="pending">待审核</option>
            </select>
          </div>
        </div>
      </div>
      
      <!-- Results Summary -->
      <div class="results-summary" v-if="!rulesetsStore.loading">
        <p>
          找到 <strong>{{ rulesetsStore.filteredRulesets.length }}</strong> 个规则集
          <span v-if="rulesetsStore.searchQuery">
            包含 "<strong>{{ rulesetsStore.searchQuery }}</strong>"
          </span>
        </p>
      </div>
      
      <!-- Loading State -->
      <div v-if="rulesetsStore.loading" class="loading-section">
        <div class="loading-spinner"></div>
        <p>正在加载规则集...</p>
      </div>
      
      <!-- Empty State -->
      <div v-else-if="rulesetsStore.filteredRulesets.length === 0" class="empty-state">
        <div class="empty-icon">
          <IconPackage :size="64" />
        </div>
        <h3>暂无规则集</h3>
        <p v-if="rulesetsStore.searchQuery">
          没有找到包含 "{{ rulesetsStore.searchQuery }}" 的规则集
        </p>
        <p v-else>
          还没有规则集，成为第一个贡献者吧！
        </p>
        <router-link to="/tutorial" class="btn btn-primary">
          观看教程：制作规则集
        </router-link>
      </div>
      
      <!-- Rulesets Grid -->
      <div v-else class="rulesets-grid">
        <RulesetCard
          v-for="ruleset in rulesetsStore.filteredRulesets"
          :key="ruleset.id"
          :ruleset="ruleset"
          @click="handleRulesetClick"
          @download="handleDownload"
        />
      </div>
      
      <!-- Load More Button (for future pagination) -->
      <div v-if="hasMoreRulesets" class="load-more-section">
        <button class="btn btn-outline" @click="loadMoreRulesets">
          加载更多
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useRulesetsStore } from '../stores/rulesets.js'
import { useAuthStore } from '../stores/auth.js'
import RulesetCard from '../components/RulesetCard.vue'
import { IconSearch, IconPackage } from '../components/icons/index.js'

const router = useRouter()
const rulesetsStore = useRulesetsStore()
const authStore = useAuthStore()

// Reactive data
const hasMoreRulesets = ref(false) // For future pagination implementation

// Computed properties
const showStatusFilter = computed(() => {
  // Show status filter for admin users
  return authStore.isAdmin
})

// Methods
const handleSearch = () => {
  // Search is handled reactively by the store's filteredRulesets computed property
  // This method can be used for debouncing in the future if needed
}

const handleSortChange = () => {
  // Sort change is handled reactively by the store
}

const handleStatusChange = () => {
  // Status filter change is handled reactively by the store
}

const handleRulesetClick = (ruleset) => {
  router.push({
    name: 'ruleset-detail',
    params: { id: ruleset.id }
  })
}

const handleDownload = (ruleset) => {
  // For now, redirect to detail page where download buttons are available
  // In the future, this could trigger a direct download
  router.push({
    name: 'ruleset-detail',
    params: { id: ruleset.id }
  })
}

const loadMoreRulesets = async () => {
  // Placeholder for future pagination implementation
}

// Lifecycle
onMounted(async () => {
  // Fetch rulesets when component mounts
  // If user is admin, show all statuses, otherwise only approved
  const status = authStore.isAdmin ? 'all' : 'approved'
  
  const { DatabaseService } = await import('../services/index.js')
  const result = await DatabaseService.getRulesets({
    status: status,
    limit: 50,
    offset: 0
  })
  
  if (result.error) {
    console.error('Failed to fetch rulesets:', result.error)
    return
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
  
  rulesetsStore.setRulesets(transformedRulesets)
})
</script>

<style scoped>
.ruleset-list {
  padding-top: 80px;
  min-height: 100vh;
  background-color: var(--background-color);
}

.page-header {
  text-align: center;
  padding: var(--spacing-xl) 0;
  margin-bottom: var(--spacing-xl);
}

.page-header h1 {
  font-size: var(--font-size-4xl);
  color: var(--text-primary);
  margin-bottom: var(--spacing-sm);
  font-weight: var(--font-weight-bold);
}

.page-header p {
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
}

/* Controls Section */
.controls-section {
  background: var(--background-white);
  padding: var(--spacing-lg);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
  margin-bottom: var(--spacing-xl);
}

.search-bar {
  margin-bottom: var(--spacing-lg);
}

.search-input-wrapper {
  position: relative;
  max-width: 600px;
  margin: 0 auto;
}

.search-input {
  width: 100%;
  padding: var(--spacing-md) var(--spacing-lg);
  padding-right: 3rem;
  border: 2px solid var(--border-color);
  border-radius: var(--border-radius-large);
  font-size: var(--font-size-base);
  transition: all var(--transition-base);
  background-color: var(--background-white);
}

.search-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(24, 144, 255, 0.1);
}

.search-icon {
  position: absolute;
  right: var(--spacing-md);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  font-size: var(--font-size-lg);
}

.filter-controls {
  display: flex;
  justify-content: center;
  gap: var(--spacing-xl);
  flex-wrap: wrap;
}

.sort-control,
.status-filter {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.sort-control label,
.status-filter label {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  white-space: nowrap;
}

.sort-select,
.status-select {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: var(--font-size-sm);
  background-color: var(--background-white);
  cursor: pointer;
  transition: all var(--transition-base);
}

.sort-select:focus,
.status-select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.1);
}

/* Results Summary */
.results-summary {
  margin-bottom: var(--spacing-lg);
  text-align: center;
}

.results-summary p {
  color: var(--text-secondary);
  font-size: var(--font-size-base);
}

.results-summary strong {
  color: var(--primary-color);
  font-weight: var(--font-weight-semibold);
}

/* Loading State */
.loading-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xxl);
  text-align: center;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-light);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: var(--spacing-md);
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-section p {
  color: var(--text-secondary);
  font-size: var(--font-size-base);
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xxl);
  text-align: center;
  background: var(--background-white);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: var(--spacing-lg);
  opacity: 0.5;
}

.empty-state h3 {
  font-size: var(--font-size-2xl);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
  font-weight: var(--font-weight-semibold);
}

.empty-state p {
  color: var(--text-secondary);
  font-size: var(--font-size-base);
  margin-bottom: var(--spacing-lg);
  max-width: 400px;
  line-height: 1.6;
}

/* Rulesets Grid */
.rulesets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-xl);
}

/* Load More Section */
.load-more-section {
  display: flex;
  justify-content: center;
  padding: var(--spacing-xl) 0;
}

/* Button Styles */
.btn {
  padding: var(--spacing-md) var(--spacing-lg);
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
  gap: var(--spacing-sm);
}

.btn-primary {
  background-color: var(--primary-color);
  color: var(--text-white);
}

.btn-primary:hover {
  background-color: var(--primary-hover);
  transform: translateY(-2px);
  box-shadow: var(--box-shadow-medium);
}

.btn-outline {
  background-color: transparent;
  color: var(--primary-color);
  border: 2px solid var(--primary-color);
}

.btn-outline:hover {
  background-color: var(--primary-color);
  color: var(--text-white);
  transform: translateY(-2px);
  box-shadow: var(--box-shadow-medium);
}

/* Responsive Design */
@media (max-width: 768px) {
  .page-header {
    padding: var(--spacing-lg) 0;
    margin-bottom: var(--spacing-lg);
  }
  
  .page-header h1 {
    font-size: var(--font-size-3xl);
  }
  
  .controls-section {
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }
  
  .search-input {
    padding: var(--spacing-sm) var(--spacing-md);
    padding-right: 2.5rem;
    font-size: var(--font-size-sm);
  }
  
  .search-icon {
    right: var(--spacing-sm);
    font-size: var(--font-size-base);
  }
  
  .filter-controls {
    gap: var(--spacing-md);
    justify-content: space-around;
  }
  
  .rulesets-grid {
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }
  
  .empty-state {
    padding: var(--spacing-xl);
  }
  
  .empty-icon {
    font-size: 3rem;
  }
  
  .empty-state h3 {
    font-size: var(--font-size-xl);
  }
}

@media (max-width: 480px) {
  .filter-controls {
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-md);
  }
  
  .sort-control,
  .status-filter {
    width: 100%;
    justify-content: space-between;
    max-width: 300px;
  }
}
</style>