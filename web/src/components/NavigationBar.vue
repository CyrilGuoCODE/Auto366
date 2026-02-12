<template>
  <nav class="navigation-bar" :class="{ 'sticky': isSticky }">
    <div class="container">
      <div class="nav-content">
        <!-- Logo and Brand -->
        <div class="nav-brand">
          <router-link to="/" class="brand-link">
            <img src="/icon_black.png" alt="Auto366" class="brand-logo" />
            <span class="brand-text">Auto366</span>
          </router-link>
        </div>

        <!-- Mobile Menu Toggle -->
        <button 
          class="mobile-toggle"
          @click="toggleMobileMenu"
          :class="{ 'active': isMobileMenuOpen }"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <!-- Navigation Links -->
        <div class="nav-links" :class="{ 'mobile-open': isMobileMenuOpen }">
          <router-link to="/" class="nav-link" @click="closeMobileMenu">
            首页
          </router-link>
          <router-link to="/tutorial" class="nav-link" @click="closeMobileMenu">
            使用教程
          </router-link>
          <router-link to="/rulesets" class="nav-link" @click="closeMobileMenu">
            社区规则集
          </router-link>
          <router-link to="/answer-viewer" class="nav-link" @click="closeMobileMenu">
            答案查看器
          </router-link>
          
          <!-- Admin Section -->
          <div v-if="authStore.isAuthenticated" class="admin-section">
            <button @click="downloadClient" class="nav-link download-link">
              下载客户端
            </button>
            <div class="admin-dropdown">
              <button class="admin-user-button" @click="toggleAdminDropdown">
                <span class="admin-email">{{ authStore.userDisplayName }}</span>
                <span class="dropdown-arrow" :class="{ 'open': isAdminDropdownOpen }">▼</span>
              </button>
              <div v-if="isAdminDropdownOpen" class="admin-dropdown-menu">
                <router-link to="/admin/dashboard" class="dropdown-item" @click="closeMobileMenu">
                  <span>管理后台</span>
                </router-link>
                <button @click="handleLogout" class="dropdown-item logout-item">
                  <span>退出登录</span>
                </button>
              </div>
            </div>
          </div>

          <button 
            v-else 
            @click="downloadClient" 
            class="nav-link download-link"
          >
            下载客户端
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUIStore } from '../stores/ui.js'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const uiStore = useUIStore()
const authStore = useAuthStore()

const isAdminDropdownOpen = ref(false)

const isSticky = computed(() => {
  // This could be enhanced with scroll detection if needed
  return false
})

const isMobileMenuOpen = computed(() => uiStore.isMobileMenuOpen)

const toggleMobileMenu = () => {
  uiStore.toggleMobileMenu()
}

const closeMobileMenu = () => {
  uiStore.setMobileMenuOpen(false)
  isAdminDropdownOpen.value = false
}

const toggleAdminDropdown = () => {
  isAdminDropdownOpen.value = !isAdminDropdownOpen.value
}

const handleLogout = async () => {
  isAdminDropdownOpen.value = false
  closeMobileMenu()
  
  const result = await authStore.logout()
  
  if (result.success) {
    uiStore.showSuccess('已成功退出登录')
    await router.push('/')
  } else {
    uiStore.showError(result.error || '退出登录失败')
  }
}

const downloadClient = () => {
  const clientDownloadUrl = 'https://github.com/cyrilguocode/Auto366/releases/latest'

  window.open(clientDownloadUrl, '_blank')

  closeMobileMenu()

  uiStore.showSuccess('正在跳转到客户端下载页面...')
}

// Close dropdown when clicking outside
const handleClickOutside = (event) => {
  if (!event.target.closest('.admin-dropdown')) {
    isAdminDropdownOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.navigation-bar {
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  transition: all 0.3s ease;
}

.navigation-bar.sticky {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.nav-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 0;
}

.nav-brand {
  display: flex;
  align-items: center;
}

.brand-link {
  display: flex;
  align-items: center;
  text-decoration: none;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 1.25rem;
}

.brand-logo {
  width: 32px;
  height: 32px;
  margin-right: 0.5rem;
}

.brand-text {
  color: var(--primary-color);
}

.mobile-toggle {
  display: none;
  flex-direction: column;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
}

.mobile-toggle span {
  width: 25px;
  height: 3px;
  background: var(--text-primary);
  margin: 3px 0;
  transition: 0.3s;
}

.mobile-toggle.active span:nth-child(1) {
  transform: rotate(-45deg) translate(-5px, 6px);
}

.mobile-toggle.active span:nth-child(2) {
  opacity: 0;
}

.mobile-toggle.active span:nth-child(3) {
  transform: rotate(45deg) translate(-5px, -6px);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.nav-link {
  text-decoration: none;
  color: var(--text-primary);
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: var(--border-radius);
  transition: all 0.3s ease;
  position: relative;
}

.nav-link:hover {
  color: var(--primary-color);
  background: rgba(24, 144, 255, 0.1);
}

.nav-link.router-link-active {
  color: var(--primary-color);
  background: rgba(24, 144, 255, 0.1);
}

.download-link {
  background: #3b82f6;
  color: white;
  border-radius: 6px;
  font-weight: 500;
  border: none;
  cursor: pointer;
}

.download-link:hover {
  background: #2563eb;
  color: white;
}

/* Admin Section */
.admin-section {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.admin-dropdown {
  position: relative;
}

.admin-user-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #374151;
  font-size: 0.875rem;
  font-weight: 400;
}

.admin-user-button:hover {
  border-color: #3b82f6;
  background: #f8fafc;
}

.admin-email {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #374151;
}

.dropdown-arrow {
  font-size: 0.75rem;
  transition: transform 0.2s ease;
  color: #6b7280;
}

.dropdown-arrow.open {
  transform: rotate(180deg);
}

.admin-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  min-width: 150px;
  z-index: 1001;
  margin-top: 0.25rem;
  overflow: hidden;
}

.dropdown-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0.75rem 1rem;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s ease;
  color: #374151;
  font-size: 0.875rem;
  font-weight: 400;
}

.dropdown-item:hover {
  background: #f3f4f6;
}

.logout-item {
  color: #ef4444;
  border-top: 1px solid #e5e7eb;
}

.logout-item:hover {
  background: #fef2f2;
}

/* Mobile Styles */
@media (max-width: 768px) {
  .mobile-toggle {
    display: flex;
  }

  .nav-links {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: white;
    flex-direction: column;
    gap: 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateY(-100%);
    opacity: 0;
    visibility: hidden;
    transition: all 0.3s ease;
  }

  .nav-links.mobile-open {
    transform: translateY(0);
    opacity: 1;
    visibility: visible;
  }

  .nav-link {
    padding: 1rem 2rem;
    border-radius: 0;
    border-bottom: 1px solid #f0f0f0;
  }

  .nav-link:last-child {
    border-bottom: none;
  }

  .admin-section {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    width: 100%;
  }

  .admin-section .download-link {
    border-bottom: 1px solid #f0f0f0;
  }

  .admin-dropdown {
    width: 100%;
  }

  .admin-user-button {
    width: 100%;
    justify-content: space-between;
    padding: 1rem 2rem;
    border: none;
    border-bottom: 1px solid #f0f0f0;
    border-radius: 0;
  }

  .admin-dropdown-menu {
    position: static;
    box-shadow: none;
    border: none;
    border-top: 1px solid #f0f0f0;
    margin-top: 0;
  }

  .dropdown-item {
    padding: 1rem 2rem;
    border-bottom: 1px solid #f0f0f0;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }
}

/* Tablet Styles */
@media (max-width: 1024px) {
  .nav-links {
    gap: 1rem;
  }
  
  .nav-link {
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }

  .admin-email {
    max-width: 120px;
  }
}
</style>