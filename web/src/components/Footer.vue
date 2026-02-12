<template>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-content">
        <!-- 左侧品牌区域 -->
        <div class="footer-brand">
          <div class="brand-logo">
            <img src="/icon.png" alt="Auto366" class="logo-image">
            <div class="brand-info">
              <h3 class="brand-name">Auto366</h3>
              <p class="brand-tagline">天学网自动化</p>
            </div>
          </div>
          
          <!-- 赞赏和QQ群区域 -->
          <div class="brand-actions">
            <div 
              class="action-button-wrapper"
              @mouseenter="showAppreciationTooltip = true"
              @mouseleave="showAppreciationTooltip = false"
            >
              <button 
                class="action-button appreciation-btn" 
                title="如果这个工具对您有帮助，欢迎赞赏支持"
              >
                <svg class="action-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                <span>赞赏支持</span>
              </button>
              
              <!-- 赞赏浮窗 -->
              <div v-if="showAppreciationTooltip" class="tooltip appreciation-tooltip">
                <div class="tooltip-header">
                  <h4>感谢您的支持！</h4>
                  <p>如果Auto366对您有帮助，欢迎赞赏支持</p>
                </div>
                <div class="qr-codes">
                  <div class="qr-code-item">
                    <img src="/prize/Cyril_prize.jpg" alt="Cyril赞赏码" class="qr-image">
                    <span class="qr-label">Cyril</span>
                  </div>
                  <div class="qr-code-item">
                    <img src="/prize/Cyp_prize.jpg" alt="Cyp赞赏码" class="qr-image">
                    <span class="qr-label">Cyp</span>
                  </div>
                </div>
                <div class="tooltip-footer">
                  <p>您的支持是我们持续改进的动力！</p>
                </div>
              </div>
            </div>
            
            <div 
              class="action-button-wrapper"
              @mouseenter="showQQTooltip = true"
              @mouseleave="showQQTooltip = false"
            >
              <button 
                class="action-button qq-group-btn" 
                title="加入QQ群，获取更多帮助与支持"
              >
                <svg class="action-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>QQ交流群</span>
              </button>
              
              <!-- QQ群浮窗 -->
              <div v-if="showQQTooltip" class="tooltip qq-tooltip">
                <div class="tooltip-header">
                  <h4>加入QQ交流群</h4>
                  <p>获取最新资讯和技术支持</p>
                </div>
                <div class="qr-codes">
                  <div class="qr-code-item">
                    <img src="/prize/qq.jpg" alt="QQ群二维码" class="qr-image">
                    <span class="qr-label">官方交流群</span>
                  </div>
                </div>
                <div class="tooltip-footer">
                  <ul class="group-features">
                    <li>• 获取最新版本信息</li>
                    <li>• 交流使用经验和技巧</li>
                    <li>• 反馈问题和建议</li>
                    <li>• 获得技术支持</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 右侧链接区域 -->
        <div class="footer-links">
          <div class="footer-section">
            <h4>快速链接</h4>
            <ul>
              <li><router-link to="/">首页</router-link></li>
              <li><a href="https://github.com/cyrilguocode/Auto366/releases/latest" target="_blank" rel="noopener">下载客户端</a></li>
              <li><router-link to="/answer-viewer">答案查看器</router-link></li>
            </ul>
          </div>
          
          <div class="footer-section">
            <h4>社区</h4>
            <ul>
              <li><a href="https://github.com/cyrilguocode/Auto366" target="_blank" rel="noopener">GitHub项目</a></li>
              <li><a href="https://github.com/cyrilguocode/Auto366/issues" target="_blank" rel="noopener">问题反馈</a></li>
              <li><router-link to="/rulesets" class="btn btn-primary">社区规则集</router-link></li>              
            </ul>
          </div>
          
          <div class="footer-section">
            <h4>关于</h4>
            <ul>
              <li><router-link to="/tutorial">使用教程</router-link></li>
              <li><a href="https://github.com/CyrilGuoCODE/Auto366?tab=readme-ov-file#auto366" target="_blank" rel="noopener">项目介绍</a></li>
            </ul>
          </div>
        </div>
      </div>
      
      <!-- 底部声明区域 -->
      <div class="footer-bottom">
        <div class="disclaimer">
          <p><strong>免责声明</strong>：本工具仅供学习和研究使用并且<strong>完全免费提供</strong>，使用者需自行承担使用风险，开发者不承担任何法律责任。</p>
          <p>项目地址：<a href="https://github.com/cyrilguocode/Auto366" target="_blank" rel="noopener">https://github.com/cyrilguocode/Auto366</a> | 许可证：GNU General Public License v3.0</p>
        </div>
        
        <div class="copyright">
          <p>&copy; 2026 Auto366. 开源项目，遵循 GPL-3.0 许可证。</p>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup>
import { ref } from 'vue'

// Footer component for the entire website
const showAppreciationTooltip = ref(false)
const showQQTooltip = ref(false)
</script>

<style scoped>
.site-footer {
  background: linear-gradient(135deg, #1890ff 0%, #0066cc 100%);
  color: white;
  margin-top: auto;
  padding: 2.5rem 0 1rem;
}

.footer-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 3rem;
  margin-bottom: 2rem;
}

/* 左侧品牌区域 */
.footer-brand {
  flex: 1;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo-image {
  width: 48px;
  height: 48px;
}

.brand-info {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: white;
}

.brand-tagline {
  font-size: 0.875rem;
  margin: 0.25rem 0 0 0;
  color: rgba(255, 255, 255, 0.8);
}

/* 品牌操作区域 */
.brand-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  flex-wrap: wrap;
}

.action-button-wrapper {
  position: relative;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 0.875rem;
  font-weight: 500;
  backdrop-filter: blur(10px);
}

.action-button:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.action-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.appreciation-btn:hover {
  background: rgba(255, 107, 107, 0.2);
  border-color: rgba(255, 107, 107, 0.4);
}

.qq-group-btn:hover {
  background: rgba(24, 144, 255, 0.2);
  border-color: rgba(24, 144, 255, 0.4);
}

/* 浮窗样式 */
.tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  color: #333;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  padding: 1.5rem;
  margin-bottom: 0.5rem;
  min-width: 420px;
  z-index: 1000;
  animation: tooltipFadeIn 0.3s ease;
}

.tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 8px solid transparent;
  border-top-color: white;
}

@keyframes tooltipFadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.tooltip-header {
  text-align: center;
  margin-bottom: 1rem;
}

.tooltip-header h4 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #333;
}

.tooltip-header p {
  margin: 0;
  font-size: 0.875rem;
  color: #666;
}

.qr-codes {
  display: flex;
  gap: 2rem;
  justify-content: center;
  margin-bottom: 1rem;
}

.qr-code-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.qr-image {
  width: 180px;
  height: 180px;
  border-radius: 8px;
  border: 2px solid #f0f0f0;
  object-fit: cover;
}

.qr-label {
  font-size: 0.75rem;
  color: #666;
  font-weight: 500;
}

.tooltip-footer {
  text-align: center;
  border-top: 1px solid #f0f0f0;
  padding-top: 1rem;
}

.tooltip-footer p {
  margin: 0;
  font-size: 0.875rem;
  color: #666;
}

.group-features {
  list-style: none;
  padding: 0;
  margin: 0;
  text-align: left;
}

.group-features li {
  font-size: 0.875rem;
  color: #666;
  margin: 0.25rem 0;
}

/* 赞赏浮窗特殊样式 */
.appreciation-tooltip {
  border-top: 3px solid #ff6b6b;
}

/* QQ群浮窗特殊样式 */
.qq-tooltip {
  border-top: 3px solid #1890ff;
}

/* 右侧链接区域 */
.footer-links {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
  flex: 2;
}

.footer-section h4 {
  color: white;
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.footer-section ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.footer-section li {
  margin: 0;
}

.footer-section a {
  color: rgba(255, 255, 255, 0.9);
  text-decoration: none;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  padding: 0.25rem 0;
  display: block;
}

.footer-section a:hover {
  color: white;
  transform: translateX(2px);
}

/* 底部声明区域 */
.footer-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.disclaimer {
  text-align: center;
}

.disclaimer p {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.75rem;
  line-height: 1.6;
  margin: 0.5rem 0;
}

.disclaimer a {
  color: white;
  text-decoration: none;
  transition: all 0.2s ease;
}

.disclaimer a:hover {
  text-decoration: underline;
}

.disclaimer strong {
  color: white;
}

.copyright {
  text-align: center;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.copyright p {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  margin: 0;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .site-footer {
    padding: 2rem 0 1rem;
  }
  
  .footer-content {
    flex-direction: column;
    gap: 2rem;
    text-align: center;
  }
  
  .brand-logo {
    justify-content: center;
  }
  
  .brand-actions {
    justify-content: center;
  }
  
  .footer-links {
    grid-template-columns: 1fr;
    gap: 2rem;
    text-align: center;
  }
  
  .footer-bottom {
    gap: 0.75rem;
  }
  
  /* 移动端浮窗调整 */
  .tooltip {
    min-width: 300px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }
  
  .qr-codes {
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }
  
  .qr-image {
    width: 120px;
    height: 120px;
  }
}

@media (max-width: 480px) {
  .footer-links {
    gap: 1.5rem;
  }
  
  .footer-section h4 {
    font-size: 0.9rem;
  }
  
  .footer-section a {
    font-size: 0.8rem;
  }
  
  .brand-name {
    font-size: 1.25rem;
  }
  
  .logo-image {
    width: 40px;
    height: 40px;
  }
}
</style>