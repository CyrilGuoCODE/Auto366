<template>
  <div class="admin-login">
    <div class="container">
      <div class="page-header">
        <h1>管理员登录</h1>
        <p>请登录以访问管理后台</p>
      </div>
      
      <div class="login-content">
        <div class="login-card">
          <form @submit.prevent="handleLogin" class="login-form">
            <div class="form-group">
              <label for="email">邮箱地址</label>
              <input
                id="email"
                v-model="form.email"
                type="email"
                required
                :disabled="loading"
                placeholder="请输入管理员邮箱"
                class="form-input"
                :class="{ 'error': errors.email }"
              />
              <span v-if="errors.email" class="error-message">{{ errors.email }}</span>
            </div>
            
            <div class="form-group">
              <label for="password">密码</label>
              <input
                id="password"
                v-model="form.password"
                type="password"
                required
                :disabled="loading"
                placeholder="请输入密码"
                class="form-input"
                :class="{ 'error': errors.password }"
              />
              <span v-if="errors.password" class="error-message">{{ errors.password }}</span>
            </div>
            
            <div v-if="errors.general" class="error-message general-error">
              {{ errors.general }}
            </div>
            
            <button
              type="submit"
              :disabled="loading || !isFormValid"
              class="login-button"
            >
              <span v-if="loading" class="loading-spinner"></span>
              {{ loading ? '登录中...' : '登录' }}
            </button>
          </form>
          
          <div class="login-footer">
            <p class="note">仅限管理员访问，不支持注册</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// Form state
const form = ref({
  email: '',
  password: ''
})

// Error state
const errors = ref({
  email: '',
  password: '',
  general: ''
})

// Loading state
const loading = ref(false)

// Computed properties
const isFormValid = computed(() => {
  return form.value.email.trim() && 
         form.value.password.trim() && 
         isValidEmail(form.value.email)
})

// Helper functions
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

const clearErrors = () => {
  errors.value = {
    email: '',
    password: '',
    general: ''
  }
}

const validateForm = () => {
  clearErrors()
  let isValid = true
  
  if (!form.value.email.trim()) {
    errors.value.email = '请输入邮箱地址'
    isValid = false
  } else if (!isValidEmail(form.value.email)) {
    errors.value.email = '请输入有效的邮箱地址'
    isValid = false
  }
  
  if (!form.value.password.trim()) {
    errors.value.password = '请输入密码'
    isValid = false
  } else if (form.value.password.length < 6) {
    errors.value.password = '密码至少需要6个字符'
    isValid = false
  }
  
  return isValid
}

// Handle login
const handleLogin = async () => {
  if (!validateForm()) {
    return
  }
  
  loading.value = true
  clearErrors()
  
  try {
    const result = await authStore.login({
      email: form.value.email.trim(),
      password: form.value.password
    })
    
    if (result.success) {
      // Redirect to intended page or dashboard
      const redirectPath = route.query.redirect || '/admin/dashboard'
      await router.push(redirectPath)
    } else {
      errors.value.general = result.error || '登录失败，请检查邮箱和密码'
    }
  } catch (error) {
    console.error('Login error:', error)
    errors.value.general = '登录过程中发生错误，请稍后重试'
  } finally {
    loading.value = false
  }
}

// Check if already authenticated
onMounted(async () => {
  if (authStore.isAuthenticated) {
    const redirectPath = route.query.redirect || '/admin/dashboard'
    await router.push(redirectPath)
  }
})
</script>

<style scoped>
.admin-login {
  padding-top: 80px;
  min-height: 100vh;
  background: #f8fafc;
}

.page-header {
  text-align: center;
  padding: 3rem 0 2rem 0;
  margin-bottom: 2rem;
}

.page-header h1 {
  font-size: 2.5rem;
  color: #2563eb;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.page-header p {
  font-size: 1rem;
  color: #64748b;
}

.login-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  padding: 0 1rem;
}

.login-card {
  background: white;
  padding: 3rem;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  width: 100%;
  max-width: 400px;
}

.login-form {
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

.form-input {
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.2s ease;
  background: white;
  color: #374151;
}

.form-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.form-input:disabled {
  background: #f9fafb;
  cursor: not-allowed;
  opacity: 0.6;
}

.form-input.error {
  border-color: #ef4444;
}

.form-input::placeholder {
  color: #9ca3af;
}

.error-message {
  color: #ef4444;
  font-size: 0.875rem;
  font-weight: 400;
}

.general-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.75rem;
  margin: 0;
  color: #dc2626;
  font-size: 0.875rem;
}

.login-button {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 0.875rem 1.5rem;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.login-button:hover:not(:disabled) {
  background: #2563eb;
}

.login-button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.login-footer {
  margin-top: 2rem;
  text-align: center;
}

.note {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0;
}

/* Responsive design */
@media (max-width: 768px) {
  .admin-login {
    padding-top: 60px;
  }
  
  .page-header {
    padding: 2rem 0 1.5rem 0;
  }
  
  .page-header h1 {
    font-size: 2rem;
  }
  
  .login-card {
    padding: 2rem;
    margin: 1rem;
    border-radius: 6px;
  }
  
  .login-content {
    min-height: 300px;
  }
}
</style>