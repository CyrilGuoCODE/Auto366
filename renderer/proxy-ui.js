class ProxyUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
  }

  // 初始化代理控制
  initProxyControl() {
    const toggleBtn = document.getElementById('toggleProxyBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.toggleProxy();
      });
    }

    // 初始化清理缓存按钮
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => {
        window.universalAnswerFeature.handleClearCache();
      });
    }

    // 初始化一键打开天学网按钮
    const openUp366Btn = document.getElementById('openUp366Btn');
    if (openUp366Btn) {
      openUp366Btn.addEventListener('click', () => {
        window.universalAnswerFeature.handleOpenUp366();
      });
    }

    // 初始化答案获取开关
    const answerCaptureToggle = document.getElementById('answerCaptureEnabled');
    if (answerCaptureToggle) {
      this.initAnswerCaptureToggle(answerCaptureToggle);
    }

    // 初始化代理端口设置
    this.initProxyPortSettings();
  }

  // 初始化答案获取开关
  async initAnswerCaptureToggle(toggleElement) {
    try {
      // 从主进程获取当前状态
      const isEnabled = await window.electronAPI.getAnswerCaptureEnabled();
      toggleElement.checked = isEnabled;

      // 监听开关变化
      toggleElement.addEventListener('change', async () => {
        const enabled = toggleElement.checked;

        try {
          await window.electronAPI.setAnswerCaptureEnabled(enabled);

          if (enabled) {
            this.logManager.addSuccessLog('答案获取已启用');
          } else {
            this.logManager.addInfoLog('答案获取已禁用');
          }
        } catch (error) {
          this.logManager.addErrorLog(`设置答案获取开关失败: ${error.message}`);
          // 恢复开关状态
          toggleElement.checked = !enabled;
        }
      });
    } catch (error) {
      console.error('初始化答案获取开关失败:', error);
      // 默认启用
      toggleElement.checked = true;
    }
  }

  // 初始化代理端口设置
  async initProxyPortSettings() {
    try {
      // 初始化代理端口
      const currentProxyPort = await window.electronAPI.getProxyPort();

      // 保存端口到localStorage，供其他脚本使用
      localStorage.setItem('proxy-port', currentProxyPort.toString());

      const proxyPortInput = document.getElementById('proxyPortInput');
      if (proxyPortInput) {
        proxyPortInput.value = currentProxyPort;

        // 监听代理端口输入变化
        proxyPortInput.addEventListener('change', async () => {
          const newPort = parseInt(proxyPortInput.value);
          if (newPort >= 1024 && newPort <= 65535) {
            await this.changeProxyPort(newPort);
          } else {
            this.logManager.addErrorLog('端口号必须在1024-65535之间');
            proxyPortInput.value = currentProxyPort;
          }
        });
      }

      // 初始化答案服务器端口
      const currentBucketPort = await window.electronAPI.getBucketPort();

      // 保存答案服务器端口到localStorage，供其他脚本使用
      localStorage.setItem('bucket-port', currentBucketPort.toString());

      const bucketPortInput = document.getElementById('bucketPortInput');
      if (bucketPortInput) {
        bucketPortInput.value = currentBucketPort;

        // 监听答案服务器端口输入变化
        bucketPortInput.addEventListener('change', async () => {
          const newPort = parseInt(bucketPortInput.value);
          if (newPort >= 1024 && newPort <= 65535) {
            await this.changeBucketPort(newPort);
          } else {
            this.logManager.addErrorLog('端口号必须在1024-65535之间');
            bucketPortInput.value = currentBucketPort;
          }
        });
      }
    } catch (error) {
      console.error('初始化代理端口设置失败:', error);
    }
  }

  // 显示端口修改对话框
  showPortChangeDialog() {
    const currentPort = document.getElementById('proxyPortInput')?.value || '5291';

    // 创建自定义对话框
    this.createPortChangeModal(currentPort);
  }

  // 创建端口修改模态对话框
  createPortChangeModal(currentPort) {
    // 移除已存在的对话框
    const existingModal = document.getElementById('portChangeModal');
    if (existingModal) {
      existingModal.remove();
    }

    // 创建模态对话框HTML
    const modalHTML = `
      <div id="portChangeModal" class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>修改代理端口</h3>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="newPortInput">新端口号 (1024-65535):</label>
              <input type="number" id="newPortInput" class="form-input" 
                     value="${currentPort}" min="1024" max="65535" 
                     placeholder="请输入端口号">
            </div>
          </div>
          <div class="modal-footer">
            <button class="secondary-btn" onclick="this.closest('.modal-overlay').remove()">
              取消
            </button>
            <button class="primary-btn" id="confirmPortChange">
              确定
            </button>
          </div>
        </div>
      </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 绑定确定按钮事件
    const confirmBtn = document.getElementById('confirmPortChange');
    const newPortInput = document.getElementById('newPortInput');

    confirmBtn.addEventListener('click', () => {
      const newPort = parseInt(newPortInput.value);
      if (newPort >= 1024 && newPort <= 65535) {
        this.changeProxyPort(newPort);
        document.getElementById('portChangeModal').remove();
      } else {
        this.logManager.addErrorLog('端口号必须在1024-65535之间');
        newPortInput.focus();
      }
    });

    // 绑定回车键事件
    newPortInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      }
    });

    // 自动聚焦并选中输入框内容
    setTimeout(() => {
      newPortInput.focus();
      newPortInput.select();
    }, 100);
  }

  // 切换代理状态
  async toggleProxy() {
    if (this.state.isProxyRunning) {
      await this.stopProxy();
    } else {
      this.startProxy();
    }
  }

  // 启动代理
  startProxy() {
    const toggleBtn = document.getElementById('toggleProxyBtn');

    // 更新按钮状态
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.innerHTML = '<i class="bi bi-hourglass-split"></i><span>启动中...</span>';
    }

    window.electronAPI.startAnswerProxy();
    this.logManager.addInfoLog('正在启动代理服务器...');

    // 设置超时检查，如果代理没有启动，显示错误信息
    setTimeout(() => {
      if (!this.state.isProxyRunning) {
        this.logManager.addErrorLog('代理服务器启动超时，请检查网络或端口占用');
        if (toggleBtn) {
          toggleBtn.disabled = false;
          toggleBtn.innerHTML = '<i class="bi bi-play-circle"></i><span>启动代理</span>';
          toggleBtn.className = 'primary-btn';
        }
      }
    }, 10000); // 10秒超时
  }

  // 停止代理
  stopProxy() {
    return new Promise((resolve) => {
      const toggleBtn = document.getElementById('toggleProxyBtn');

      // 更新按钮状态，防止重复点击
      if (toggleBtn) {
        toggleBtn.disabled = true;
        toggleBtn.innerHTML = '<i class="bi bi-hourglass-split"></i><span>停止中...</span>';
      }

      window.electronAPI.stopAnswerProxy();
      this.logManager.addInfoLog('正在停止代理服务器...');

      // 设置停止开始时间
      const stopStartTime = Date.now();
      let timeoutId = null;
      let resolved = false;

      // 监听代理状态变化
      const checkStopped = () => {
        if (resolved) return;

        if (!this.state.isProxyRunning) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          this.logManager.addSuccessLog('代理服务器已成功停止');
          resolve();
          return;
        }

        // 检查是否超过最大等待时间
        const elapsed = Date.now() - stopStartTime;
        if (elapsed < 8000) { // 8秒内继续检查
          setTimeout(checkStopped, 200); // 每200ms检查一次
        }
      };

      // 开始检查
      checkStopped();

      // 设置超时处理
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;

        if (this.state.isProxyRunning) {
          this.logManager.addErrorLog('代理服务器停止超时，请尝试手动关闭进程或重启应用');

          // 强制更新状态为停止
          this.state.isProxyRunning = false;
          this.updateProxyStatus({
            running: false,
            message: '代理服务器停止超时'
          });
        } else {
          this.logManager.addInfoLog('代理服务器已停止');
        }

        resolve(); // 即使超时也要resolve，避免阻塞后续操作
      }, 8000); // 8秒超时
    });
  }

  // 更新代理状态
  updateProxyStatus(data) {
    const statusElement = document.getElementById('proxyStatus');
    const toggleBtn = document.getElementById('toggleProxyBtn');

    if (data.running) {
      this.state.isProxyRunning = true;
      const host = data.host || '127.0.0.1';
      const port = data.port || '5291';
      statusElement.textContent = `已开启在 ${host}:${port}`;
      statusElement.className = 'status-value running';

      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = '<i class="bi bi-stop-circle"></i><span>停止代理</span>';
        toggleBtn.className = 'danger-btn';
      }

      this.logManager.addInfoLog(`代理服务器已启动，监听地址: ${host}:${port}`);
    } else {
      this.state.isProxyRunning = false;
      statusElement.textContent = '已停止';
      statusElement.className = 'status-value stopped';

      if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = '<i class="bi bi-play-circle"></i><span>启动代理</span>';
        toggleBtn.className = 'primary-btn';
      }

      this.logManager.addInfoLog('代理服务器已停止');
    }
  }

  // 修改代理端口
  async changeProxyPort(port) {
    try {
      const result = await window.electronAPI.setProxyPort(port);
      if (result.success) {
        // 保存端口到localStorage，供其他脚本使用
        localStorage.setItem('proxy-port', port.toString());

        // 更新设置页面的输入框
        const proxyPortInput = document.getElementById('proxyPortInput');
        if (proxyPortInput) {
          proxyPortInput.value = port;
        }

        this.logManager.addSuccessLog(`代理端口已修改为: ${port}`);

        // 如果代理正在运行，重启代理服务器
        if (this.state.isProxyRunning) {
          this.logManager.addInfoLog('正在重启代理服务器...');
          try {
            await this.stopProxy();
            // 等待一小段时间确保完全停止
            await new Promise(resolve => setTimeout(resolve, 500));
            this.startProxy();
          } catch (error) {
            this.logManager.addErrorLog(`重启代理服务器失败: ${error.message}`);
            // 如果停止失败，仍然尝试启动
            this.logManager.addInfoLog('尝试强制启动代理服务器...');
            this.startProxy();
          }
        }
      } else {
        this.logManager.addErrorLog(`修改端口失败: ${result.error}`);
      }
    } catch (error) {
      this.logManager.addErrorLog(`修改端口失败: ${error.message}`);
    }
  }

  // 修改答案服务器端口
  async changeBucketPort(port) {
    try {
      const result = await window.electronAPI.setBucketPort(port);
      if (result.success) {
        // 保存端口到localStorage，供其他脚本使用
        localStorage.setItem('bucket-port', port.toString());

        // 更新设置页面的输入框
        const bucketPortInput = document.getElementById('bucketPortInput');
        if (bucketPortInput) {
          bucketPortInput.value = port;
        }

        this.logManager.addSuccessLog(`答案服务器端口已修改为: ${port}`);

        // 如果代理正在运行，重启代理服务器以应用新的答案服务器端口
        if (this.state.isProxyRunning) {
          this.logManager.addInfoLog('正在重启代理服务器以应用新的答案服务器端口...');
          try {
            await this.stopProxy();
            // 等待一小段时间确保完全停止
            await new Promise(resolve => setTimeout(resolve, 500));
            this.startProxy();
          } catch (error) {
            this.logManager.addErrorLog(`重启代理服务器失败: ${error.message}`);
            // 如果停止失败，仍然尝试启动
            this.logManager.addInfoLog('尝试强制启动代理服务器...');
            this.startProxy();
          }
        }
      } else {
        this.logManager.addErrorLog(`修改答案服务器端口失败: ${result.error}`);
      }
    } catch (error) {
      this.logManager.addErrorLog(`修改答案服务器端口失败: ${error.message}`);
    }
  }

  // 更新捕获状态
  updateCaptureStatus(data) {
    const statusElement = document.getElementById('captureStatus');
    const startBtn = document.getElementById('startCaptureBtn');
    const stopBtn = document.getElementById('stopCaptureBtn');

    if (data.capturing) {
      statusElement.textContent = '监听中';
      statusElement.className = 'status-value running';
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      this.logManager.addSuccessLog('网络监听已启动');
    } else {
      statusElement.textContent = '未开始';
      statusElement.className = 'status-value stopped';
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      this.logManager.addInfoLog('网络监听已停止');
    }
  }
}

export default ProxyUI;
