<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { IconSearch, IconStar, IconRobot, IconUsers, IconMessage, IconVideo } from '../components/icons/index.js'

const router = useRouter()
const route = useRoute()

// Check for URL parameter redirect on mount
onMounted(() => {
  const urlParam = route.query.url
  if (urlParam) {
    // Redirect to answer-viewer with the URL parameter
    router.push({
      path: '/answer-viewer',
      query: { url: urlParam }
    })
  }
})

// Demo data for feature showcase
const features = ref([
  {
    id: 1,
    title: '答案获取',
    description: '智能检测下载的练习文件，自动提取听力答案和题目答案，支持多种文件格式解析',
    icon: IconSearch,
    action: '体验网页端',
    route: '/answer-viewer'
  },
  {
    id: 2,
    title: '自动作答',
    description: '使用规则集实现自动化填写答题，支持多种题型，解放双手提高学习效率',
    icon: IconRobot,
    action: '下载客户端',
    external: 'https://github.com/cyrilguocode/Auto366/releases/latest'
  },
  {
    id: 3,
    title: '社区分享',
    description: '分享和下载社区贡献的规则集，共建自动化规则库，让更多人受益',
    icon: IconUsers,
    action: '浏览规则集',
    route: '/rulesets'
  }
])

const communityLinks = ref([
  {
    name: 'QQ 交流群',
    description: '加入官方QQ群，获取最新资讯和技术支持',
    icon: IconMessage,
    action: () => window.open('https://qm.qq.com/q/UwdHV1aH2S', '_blank')
  },
  {
    name: '使用教程',
    description: '观看使用教程视频，快速上手',
    icon: IconVideo,
    action: () => window.open('https://www.bilibili.com/video/BV195xLzEESR/', '_blank')
  },
  {
    name: 'GitHub 仓库',
    description: '查看源代码，参与开源项目开发',
    icon: IconStar,
    action: () => window.open('https://github.com/cyrilguocode/auto366', '_blank')
  }
])

const navigateTo = (route) => {
  if (route) {
    router.push(route)
  }
}

const openExternal = (url) => {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="home">
    <!-- Hero Section -->
    <section class="hero-section">
      <div class="container">
        <div class="hero-content">
          <div class="hero-text">
            <h1 class="hero-title">
              Auto366
            </h1>
            <p class="hero-subtitle">
              天学网自动化答题工具
            </p>
            <p class="hero-description">
              Auto366 是一个专为天学网设计的自动化答题工具，支持多种题型自动填写，单词pk快速自动填写，答案获取等等，让您专注于学习而不是重复性操作。
            </p>
            <div class="hero-actions">
              <router-link to="/tutorial" class="btn btn-primary">
                观看教程
              </router-link>
              <a 
                href="https://github.com/cyrilguocode/Auto366/releases/latest" 
                target="_blank"
                class="btn btn-secondary"
              >
                下载客户端
              </a>
            </div>
          </div>
          <div class="hero-video">
            <div class="video-container">
              <iframe
                src="https://player.bilibili.com/player.html?bvid=BV195xLzEESR&page=1"
                scrolling="no"
                border="0"
                frameborder="no"
                framespacing="0"
                allowfullscreen="true"
                class="bilibili-video"
              ></iframe>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section class="features-section">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">核心功能</h2>
        </div>
        
        <div class="features-grid">
          <div 
            v-for="feature in features" 
            :key="feature.id"
            class="feature-card"
          >
            <div class="feature-icon">
              <component :is="feature.icon" :size="48" />
            </div>
            <h3 class="feature-title">{{ feature.title }}</h3>
            <p class="feature-description">{{ feature.description }}</p>
            <button 
              class="feature-action"
              @click="feature.route ? navigateTo(feature.route) : openExternal(feature.external)"
            >
              {{ feature.action }}
              <svg class="action-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Community Section -->
    <section class="community-section">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">社区资源</h2>
          <p class="section-subtitle">
            加入我们的社区，获取更多资源和支持
          </p>
        </div>
        
        <div class="community-grid">
          <div 
            v-for="link in communityLinks" 
            :key="link.name"
            class="community-card"
            @click="link.action"
          >
            <div class="community-icon">
              <component :is="link.icon" :size="32" />
            </div>
            <h3 class="community-title">{{ link.name }}</h3>
            <p class="community-description">{{ link.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="cta-section">
      <div class="container">
        <div class="cta-content">
          <h2 class="cta-title">准备开始使用了吗？</h2>
          <p class="cta-description">
            立即体验 Auto366 的强大功能
          </p>
          <div class="cta-actions">
            <router-link to="/tutorial" class="btn btn-primary btn-large">
              观看教程
            </router-link>
            <a 
              href="https://github.com/cyrilguocode/Auto366/releases/latest" 
              target="_blank"
              class="btn btn-outline btn-large"
            >
              下载客户端
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  padding-top: 80px; /* Account for fixed navigation */
}

/* Hero Section */
.hero-section {
  background: linear-gradient(135deg, var(--primary-color) 0%, #0066cc 100%);
  color: white;
  padding: 4rem 0;
  position: relative;
  overflow: hidden;
}

.hero-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  align-items: center;
  min-height: 500px;
}

.hero-text {
  z-index: 2;
}

.hero-title {
  font-size: 3rem;
  font-weight: 700;
  margin-bottom: 1rem;
  line-height: 1.2;
}

.hero-subtitle {
  font-size: 1.5rem;
  margin-bottom: 1rem;
  opacity: 0.9;
  font-weight: 500;
}

.hero-description {
  font-size: 1.1rem;
  line-height: 1.6;
  margin-bottom: 2rem;
  opacity: 0.8;
}

.hero-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.hero-video {
  display: flex;
  justify-content: center;
  align-items: center;
}

.video-container {
  position: relative;
  width: 100%;
  max-width: 500px;
  transform: perspective(1000px) rotateY(-15deg) rotateX(5deg);
  transition: transform 0.3s ease;
}

.video-container:hover {
  transform: perspective(1000px) rotateY(-10deg) rotateX(2deg) scale(1.05);
}

.video-container iframe {
  position: relative;
  width: 100%;
  height: 280px;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  border: none;
}

.video-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 0.3s ease;
  border-radius: 16px;
  pointer-events: none;
}

.video-container:hover .video-overlay {
  opacity: 1;
}

.play-button {
  width: 80px;
  height: 80px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: 2rem;
  cursor: pointer;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
}

.play-button:hover {
  transform: scale(1.1);
  background: white;
}

.play-button svg {
  width: 32px;
  height: 32px;
  margin-left: 4px;
}

/* Button Styles */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.75rem 1.5rem;
  border-radius: var(--border-radius);
  text-decoration: none;
  font-weight: 600;
  transition: all 0.3s ease;
  border: 2px solid transparent;
  cursor: pointer;
  font-size: 1rem;
}

.btn-primary {
  background: white;
  color: var(--primary-color);
}

.btn-primary:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
}

.btn-secondary {
  background: transparent;
  color: white;
  border-color: white;
}

.btn-secondary:hover {
  background: white;
  color: var(--primary-color);
  transform: translateY(-2px);
}

.btn-outline {
  background: transparent;
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.btn-outline:hover {
  background: var(--primary-color);
  color: white;
}

.btn-large {
  padding: 1rem 2rem;
  font-size: 1.1rem;
}

/* Sections */
.features-section,
.community-section {
  padding: 4rem 0;
}

.cta-section {
  padding: 4rem 0;
  background: #f8f9fa;
}

.section-header {
  text-align: center;
  margin-bottom: 3rem;
}

.section-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.section-subtitle {
  font-size: 1.2rem;
  color: var(--text-secondary);
  max-width: 600px;
  margin: 0 auto;
}

/* Features Grid */
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
}

.feature-card {
  background: white;
  padding: 2.5rem;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  text-align: center;
  transition: all 0.3s ease;
  border: 1px solid #f0f0f0;
}

.feature-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.feature-icon {
  font-size: 3rem;
  margin-bottom: 1.5rem;
  display: block;
}

.feature-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.feature-description {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 2rem;
}

.feature-action {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: var(--border-radius);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.feature-action:hover {
  background: var(--primary-light);
  transform: translateX(5px);
}

.action-icon {
  width: 16px;
  height: 16px;
}

/* Community Grid */
.community-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
}

.community-card {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid #f0f0f0;
}

.community-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
  border-color: var(--primary-color);
}

.community-icon {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  display: block;
}

.community-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.community-description {
  color: var(--text-secondary);
  line-height: 1.5;
  font-size: 0.95rem;
}

/* CTA Section */
.cta-content {
  text-align: center;
  max-width: 600px;
  margin: 0 auto;
}

.cta-title {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.cta-description {
  font-size: 1.2rem;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}

.cta-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

/* Mobile Responsive */
@media (max-width: 768px) {
  .home {
    padding-top: 70px;
  }

  .hero-content {
    grid-template-columns: 1fr;
    gap: 2rem;
    text-align: center;
  }

  .hero-title {
    font-size: 2.5rem;
  }

  .hero-subtitle {
    font-size: 1.25rem;
  }

  .hero-actions {
    justify-content: center;
  }

  .hero-video {
    margin-top: 2rem;
  }

  .video-container {
    max-width: 100%;
    transform: perspective(1000px) rotateY(-10deg) rotateX(3deg);
  }

  .video-container:hover {
    transform: perspective(1000px) rotateY(-5deg) rotateX(1deg) scale(1.02);
  }

  .video-container iframe {
    height: 200px;
  }

  .section-title {
    font-size: 2rem;
  }

  .features-grid,
  .community-grid {
    grid-template-columns: 1fr;
  }

  .feature-card,
  .community-card {
    padding: 2rem 1.5rem;
  }

  .cta-title {
    font-size: 2rem;
  }

  .cta-actions {
    flex-direction: column;
    align-items: center;
  }

  .btn-large {
    width: 100%;
    max-width: 300px;
  }
}

/* Tablet Responsive */
@media (max-width: 1024px) {
  .hero-content {
    gap: 2rem;
  }

  .hero-title {
    font-size: 2.75rem;
  }

  .features-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }
}
</style>