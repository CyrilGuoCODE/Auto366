<template>
  <div class="tutorial-page">
    <div class="container">
      <!-- Header -->
      <div class="page-header">
        <h1 class="page-title">使用教程</h1>
        <p class="page-subtitle">学习如何使用Auto366自动化工具</p>
      </div>

      <!-- Under Development Notice -->
      <div class="development-notice">
        <h2>页面开发中</h2>
        <p>使用教程页面正在开发中，敬请期待！</p>
        <div class="notice-actions">
          <router-link to="/" class="btn btn-primary">
            返回首页
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconConstruction } from '../components/icons/index.js'
</script>

<style scoped>
.tutorial-page {
  padding-top: 80px;
  min-height: 100vh;
  background-color: var(--background-color);
}

.container {
  max-width: 800px;
}

/* Page Header */
.page-header {
  text-align: center;
  margin-bottom: var(--spacing-xl);
  padding: var(--spacing-xl) 0;
}

.page-title {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
}

.page-subtitle {
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
  line-height: 1.6;
}

/* Development Notice */
.development-notice {
  background: var(--background-white);
  border-radius: var(--border-radius-large);
  box-shadow: var(--box-shadow-light);
  padding: var(--spacing-3xl);
  text-align: center;
  max-width: 600px;
  margin: 0 auto;
}

.notice-icon {
  margin-bottom: var(--spacing-lg);
  color: var(--primary-color);
  opacity: 0.8;
}

.development-notice h2 {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
}

.development-notice p {
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: var(--spacing-xl);
}

.notice-actions {
  display: flex;
  gap: var(--spacing-md);
  justify-content: center;
  flex-wrap: wrap;
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
  min-width: 120px;
}

.btn-primary {
  background-color: var(--primary-color);
  color: var(--text-white);
}

.btn-primary:hover {
  background-color: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-secondary {
  background-color: var(--background-white);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

/* Responsive design */
@media (max-width: 768px) {
  .tutorial-page {
    padding-top: 60px;
  }
  
  .container {
    padding: 0 var(--spacing-sm);
  }
  
  .page-header {
    padding: var(--spacing-lg) 0;
  }
  
  .page-title {
    font-size: var(--font-size-2xl);
  }
  
  .page-subtitle {
    font-size: var(--font-size-base);
  }
  
  .development-notice {
    padding: var(--spacing-xl);
  }
  
  .development-notice h2 {
    font-size: var(--font-size-xl);
  }
  
  .development-notice p {
    font-size: var(--font-size-base);
  }
  
  .notice-actions {
    flex-direction: column;
    align-items: center;
  }
  
  .btn {
    width: 100%;
    max-width: 200px;
  }
}

@media (max-width: 480px) {
  .development-notice {
    padding: var(--spacing-lg);
  }
  
  .notice-icon {
    margin-bottom: var(--spacing-md);
  }
}
</style>