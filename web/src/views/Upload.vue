<template>
  <div class="upload">
    <div class="container">
      <div class="page-header">
        <h1>上传规则集</h1>
        <p>分享您的规则集给社区</p>
      </div>
      
      <div class="placeholder-content">
        <div class="placeholder-card">
          <h3>
            <IconConstruction :size="24" class="construction-icon" />
            功能开发中
          </h3>
          <p>规则集上传功能正在开发中，敬请期待！</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconConstruction } from '../components/icons/index.js'

// Placeholder component - will be implemented in later tasks
</script>

<style scoped>
.upload {
  padding-top: 80px;
  min-height: 100vh;
}

.page-header {
  text-align: center;
  padding: 2rem 0;
  margin-bottom: 2rem;
}

.page-header h1 {
  font-size: 2.5rem;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.page-header p {
  font-size: 1.1rem;
  color: var(--text-secondary);
}

.placeholder-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.placeholder-card {
  background: white;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  text-align: center;
  max-width: 400px;
}

.placeholder-card h3 {
  font-size: 1.5rem;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.placeholder-card p {
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>