<template>
  <div class="not-found">
    <div class="container">
      <div class="not-found-content">
        <div class="not-found-icon">
          <svg t="1770874072537" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1619" width="256" height="256"><path d="M512 102.4c225.28 0 409.6 184.32 409.6 409.6s-184.32 409.6-409.6 409.6-409.6-184.32-409.6-409.6 184.32-409.6 409.6-409.6m0-102.4C230.4 0 0 230.4 0 512s230.4 512 512 512 512-230.4 512-512S793.6 0 512 0z" fill="#1b6bf0" p-id="1620"></path><path d="M512 256c30.72 0 51.2 20.48 51.2 51.2v204.8c0 30.72-20.48 51.2-51.2 51.2s-51.2-20.48-51.2-51.2V307.2c0-30.72 20.48-51.2 51.2-51.2z" fill="#1b6bf0" p-id="1621"></path><path d="M512 716.8m-51.2 0a51.2 51.2 0 1 0 102.4 0 51.2 51.2 0 1 0-102.4 0Z" fill="#1b6bf0" p-id="1622"></path></svg>
        </div>
        
        <h1 class="not-found-title">404</h1>
        <h2 class="not-found-subtitle">页面未找到</h2>
        <p class="not-found-description">
          抱歉，您访问的页面不存在或已被移动。
        </p>
        
        <div class="not-found-actions">
          <router-link to="/" class="btn btn-primary">
            返回首页
          </router-link>
          <button @click="goBack" class="btn btn-secondary">
            返回上页
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const goBack = () => {
  if (window.history.length > 1) {
    router.go(-1)
  } else {
    router.push('/')
  }
}
</script>

<style scoped>
.not-found {
  padding-top: 80px;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

.not-found-content {
  text-align: center;
  max-width: 500px;
  padding: 2rem;
}

.not-found-icon {
  width: 120px;
  height: 120px;
  margin: 0 auto 2rem;
  color: var(--text-tertiary);
}

.not-found-icon svg {
  width: 100%;
  height: 100%;
}

.not-found-title {
  font-size: 6rem;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 1rem;
  line-height: 1;
}

.not-found-subtitle {
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.not-found-description {
  font-size: 1.1rem;
  color: var(--text-secondary);
  margin-bottom: 2rem;
  line-height: 1.6;
}

.not-found-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.75rem 1.5rem;
  border-radius: var(--border-radius);
  text-decoration: none;
  font-weight: 600;
  transition: all var(--transition-base);
  border: 2px solid transparent;
  cursor: pointer;
  font-size: 1rem;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-2px);
}

.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border-color: var(--border-color);
}

.btn-secondary:hover {
  background: var(--background-light);
  border-color: var(--primary-color);
  color: var(--primary-color);
}

@media (max-width: 768px) {
  .not-found-title {
    font-size: 4rem;
  }
  
  .not-found-subtitle {
    font-size: 1.5rem;
  }
  
  .not-found-actions {
    flex-direction: column;
    align-items: center;
  }
  
  .btn {
    width: 100%;
    max-width: 200px;
  }
}
</style>