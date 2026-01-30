let cachePath = ''
function pathJoin(...parts) {
  // 过滤空部分并拼接
  const filteredParts = parts.filter(part => part && part !== '.');

  // 拼接路径并规范化
  let joined = filteredParts.join('/')
    .replace(/\/+/g, '/')          // 将多个斜杠替换为单个斜杠
    .replace(/^\/+|\/+$/g, '')     // 移除开头和结尾的斜杠
    .replace(/\/\.\//g, '/')       // 处理当前目录引用
    .replace(/\/[^\/]+\/\.\.\//g, '/'); // 简单的上级目录处理

  return joined;
}
class Global {
  constructor() {
    this.initScale();
    this.initBackBtn();
    this.initSettingsBtn()
    this.scale = null;
  }

  async initScale() {
    this.scale = await window.electronAPI.getScaleFactor()
    const scaleInput = document.getElementById('scaleInput')
    const scaleInputPk = document.getElementById('scaleInput-pk')
    scaleInput.value = scaleInputPk.value = this.scale

    const getScale = document.getElementById('getScale')
    const getScalePk = document.getElementById('getScale-pk')
    getScale.addEventListener('click', async () => {
      this.scale = await window.electronAPI.getScaleFactor()
      scaleInput.value = scaleInputPk.value = this.scale
      document.getElementById('scaleHelpText').innerHTML = '当前屏幕缩放获取成功！'
    })
    getScalePk.addEventListener('click', async () => {
      this.scale = await window.electronAPI.getScaleFactor()
      scaleInput.value = scaleInputPk.value = this.scale
      document.getElementById('scaleHelpText-pk').innerHTML = '当前屏幕缩放获取成功！'
    })
    scaleInput.addEventListener('change', async () => {
      this.scale = scaleInput.value
      window.electronAPI.setGlobalScale(this.scale)
    })
    scaleInputPk.addEventListener('change', async () => {
      this.scale = scaleInputPk.value
      window.electronAPI.setGlobalScale(this.scale)
    })
  }

  initBackBtn() {
    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        new MainMenu().showMainMenu();
      });
    });
  }

  initSettingsBtn() {
    window.electronAPI.setCachePath(localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles')
    cachePath = localStorage.getItem('cache-path') || 'D:\\Up366StudentFiles'
    document.getElementsByClassName('settings-btn')[0].addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'flex'
      document.getElementById('cache-path').value = cachePath
      document.getElementById('keep-cache-files').checked = localStorage.getItem('keep-cache-files') === 'true'
    })

    const settingsModal = document.getElementById('settings-modal');
    const settingsCloseBtn = settingsModal.querySelector('.close');

    settingsCloseBtn.addEventListener('click', () => {
      settingsModal.style.display = 'none'
    })

    window.addEventListener('click', (event) => {
      if (event.target === settingsModal) {
        settingsModal.style.display = 'none'
      }
    })

    document.getElementById('browse-cache').addEventListener('click', function () {
      window.electronAPI.openDirectoryChoosing()
    })
    window.electronAPI.chooseDirectory((event, path) => {
      document.getElementById('cache-path').value = path
    })
    document.getElementById('save-settings').addEventListener('click', function () {
      const cachePathValue = document.getElementById('cache-path').value
      const keepCacheFiles = document.getElementById('keep-cache-files').checked

      if (window.electronAPI.setCachePath(cachePathValue)) {
        localStorage.setItem('cache-path', cachePathValue)
        localStorage.setItem('keep-cache-files', keepCacheFiles.toString())
        cachePath = cachePathValue
        document.getElementById('settings-modal').style.display = 'none'
      }
      else {
        document.getElementById('error-message').textContent = '路径不正确，请设置正确的路径'
      }
    })
    document.getElementById('reset-settings').addEventListener('click', function () {
      document.getElementById('cache-path').value = 'D:\\Up366StudentFiles'
      document.getElementById('keep-cache-files').checked = false
      cachePath = 'D:\\Up366StudentFiles'
    })
    document.getElementById('check-updates').addEventListener('click', function () {
      window.electronAPI.checkForUpdates()
      showToast('正在检查更新...', 'info')
    })
  }
}

class MainMenu {
  constructor() {
    this.initEventListeners();
  }

  initEventListeners() {
    document.querySelectorAll('.feature-card').forEach(card => {
      const feature = card.getAttribute('data-type');
      card.addEventListener('click', () => this.showFeature(feature));
    });
  }

  showFeature(feature) {
    document.getElementById('main-menu').style.display = 'none';
    document.querySelectorAll('.content-area').forEach(area => {
      area.classList.remove('active');
    });
    document.getElementById(feature + '-content').classList.add('active');
  }

  showMainMenu() {
    document.getElementById('main-menu').style.display = 'block';
    document.querySelectorAll('.content-area').forEach(area => {
      area.classList.remove('active');
    });
  }
}

class ListeningFeature {
  constructor() {
    this.initialFiles = null;
    this.initLocations()
    this.initEventListeners();
  }

  initLocations() {
    let locations = localStorage.getItem('pos-listening')
    if (locations) {
      locations = JSON.parse(locations)
      window.electronAPI.setLocations(locations);
    }
  }

  initEventListeners() {
    document.getElementById('locationBtn').addEventListener('click', () => {
      window.electronAPI.openLocationWindow();
    });

    document.getElementById('startBtn').addEventListener('click', () => {
      const resultDiv = document.getElementById('result');
      resultDiv.innerHTML = `
        <strong>正在执行自动填充...</strong><br>
        请稍候，不要移动鼠标或切换窗口
      `;
      window.electronAPI.startPoint();
    });

    document.getElementById('deleteBtn').addEventListener('click', () => {
      this.handleDeleteFiles();
    });

    document.getElementById('firstCheck').addEventListener('click', () => {
      this.handleFirstCheck();
    });

    document.getElementById('secondCheck').addEventListener('click', () => {
      this.handleSecondCheck();
    });

    window.electronAPI.updateLocations((event, locations) => {
      localStorage.setItem('pos-listening', JSON.stringify(locations))
      const display = `
        <strong>坐标设置完成！</strong><br>
        🔴 输入框位置: (${locations.pos1.x}, ${locations.pos1.y})<br>
        🔵 下一页按钮位置: (${locations.pos2.x}, ${locations.pos2.y})<br>
        <br>
        <strong>下一步：</strong><br>
        点击"开始填充数据"按钮开始自动填写
      `;
      document.getElementById('locationData').innerHTML = display;
      document.getElementById('startBtn').disabled = false;
    });

    window.electronAPI.onOperationComplete((event, result) => {
      this.handleOperationComplete(result);
    });
  }

  handleDeleteFiles() {
    const resultDiv = document.getElementById('result');

    if (confirm(`警告：此操作将删除 ${pathJoin(cachePath, 'resources')} 目录下的所有文件！\n\n确定要继续吗？`)) {
      resultDiv.innerHTML = `
        <strong>正在删除文件...</strong><br>
        请稍候
      `;

      const result = window.electronAPI.deleteAllFiles();

      if (result.error) {
        resultDiv.innerHTML = `
          <strong>删除失败</strong><br>
          错误信息: ${result.error}
        `;
      } else {
        resultDiv.innerHTML = `
          <strong>删除成功！</strong><br>
          已删除 ${result.deletedCount} 个文件/目录<br>
          <br>
          <strong>现在可以：</strong><br>
          1. 点击"首次检测"按钮<br>
          2. 下载新的练习
          3. 点击再次检测按钮
        `;
      }
    }
  }

  handleFirstCheck() {
    const resultDiv = document.getElementById('result');
    const secondCheckBtn = document.getElementById('secondCheck');
    const firstCheckBtn = document.getElementById('firstCheck');

    this.initialFiles = window.electronAPI.checkFirst();

    if (this.initialFiles === null) {
      resultDiv.innerHTML = `<span class="error">资源路径不存在: ${pathJoin(cachePath, 'resources')}</span>`;
      return;
    }

    resultDiv.innerHTML = `
      <strong>首次检测完成！</strong><br>
      当前资源目录包含 ${this.initialFiles.length} 个文件<br>
      <br>
      <strong>下一步：</strong><br>
      1. 清理资源目录（如果有文件请点击"删除已下载"按钮清理资源目录（必须））<br>
      2. 在天学网中找到并下载一个未下载的练习<br>
      3. 确保下载完成后，点击"再次检测"按钮
    `;
    secondCheckBtn.disabled = false;
    firstCheckBtn.disabled = true;
  }

  handleSecondCheck() {
    const resultDiv = document.getElementById('result');
    const secondCheckBtn = document.getElementById('secondCheck');
    const firstCheckBtn = document.getElementById('firstCheck');

    const result = window.electronAPI.checkSecond(this.initialFiles);

    if (result.error) {
      resultDiv.innerHTML = `<span class="error">${result.error}</span>`;
    } else {
      resultDiv.innerHTML = `
        <strong>再次检测完成！</strong><br>
        检测到 ${result.answer.length} 个答案<br>
        <br>
        <strong>答案列表：</strong><br>
        ${result.answer.map((ans, index) => `${index + 1}. ${ans}`).join('<br>')}
        <br>
        <br>
        <strong>下一步：</strong><br>
        点击"定位填充数据"按钮，在练习页面中设置坐标
      `;
    }

    secondCheckBtn.disabled = true;
    firstCheckBtn.disabled = false;
  }

  handleOperationComplete(result) {
    const resultDiv = document.getElementById('result');
    if (result.success) {
      resultDiv.innerHTML = `
        <strong>自动填充完成！</strong><br>
        所有答案已成功填写并翻页<br>
        <br>
        <strong>可以开始新的练习：</strong><br>
        1. 重新点击"首次检测"按钮<br>
        2. 下载新的练习<br>
        3. 重复上述流程
      `;
    } else {
      resultDiv.innerHTML = `
        <strong>操作失败</strong><br>
        错误信息: ${result.error}<br>
        <br>
      `;
    }
  }
}

class WordPKFeature {
  constructor() {
    this.injectionStatus = '等待中';
    this.processedRequests = 0;
    this.pkConfigKey = 'auto366_pk_config';
    this.pkConfig = null;
    this.pkEnabled = false;
    this.initEventListeners();
    this.initIpcListeners();
    this.loadPkConfig();
    this.updateStatus();
  }

  getDefaultPkConfig() {
    return {
      enabled: false,
      zipPath: '',
      md5: '',
      md5Base64: '',
      size: 0
    };
  }

  loadPkConfigFromStorage() {
    try {
      const raw = window.localStorage.getItem(this.pkConfigKey);
      if (!raw) return this.getDefaultPkConfig();
      const parsed = JSON.parse(raw);
      return Object.assign(this.getDefaultPkConfig(), parsed || {});
    } catch (e) {
      console.error('读取PK配置失败:', e);
      return this.getDefaultPkConfig();
    }
  }

  savePkConfigToStorage(config) {
    try {
      window.localStorage.setItem(this.pkConfigKey, JSON.stringify(config || this.pkConfig || this.getDefaultPkConfig()));
    } catch (e) {
      console.error('保存PK配置到localStorage失败:', e);
    }
  }

  async loadPkConfig() {
    try {
      const stored = this.loadPkConfigFromStorage();
      const backend = await window.electronAPI.getPkConfig();
      const serverCfg = (backend && backend.success && backend.config) ? backend.config : {};
      const cfg = this.getDefaultPkConfig();

      cfg.zipPath = (stored.zipPath && stored.zipPath.trim())
        || serverCfg.zipPath
        || cfg.zipPath;

      cfg.md5 = (stored.md5 && stored.md5.trim())
        || serverCfg.md5
        || cfg.md5;

      cfg.md5Base64 = (stored.md5Base64 && stored.md5Base64.trim())
        || serverCfg.md5Base64
        || cfg.md5Base64;

      const storedSize = Number.isFinite(stored.size) && stored.size > 0 ? stored.size : 0;
      const serverSize = Number.isFinite(serverCfg.size) && serverCfg.size > 0 ? serverCfg.size : 0;
      cfg.size = storedSize || serverSize || cfg.size;

      this.pkConfig = cfg;
      this.pkEnabled = !!serverCfg.enabled;
      this.applyPkConfigToForm();
      this.updateToggleButtonText();
      await this.syncPkConfigToBackend();
    } catch (error) {
      console.error('加载PK配置失败:', error);
    }
  }

  applyPkConfigToForm() {
    const cfg = this.pkConfig || this.getDefaultPkConfig();
    const zipPathEl = document.getElementById('pkZipPath');
    const md5El = document.getElementById('pkMd5');
    const md5b64El = document.getElementById('pkMd5Base64');
    const sizeEl = document.getElementById('pkSize');
    if (zipPathEl) zipPathEl.value = cfg.zipPath || '';
    if (md5El) md5El.value = cfg.md5 || '';
    if (md5b64El) md5b64El.value = cfg.md5Base64 || '';
    if (sizeEl) sizeEl.value = cfg.size || 0;
  }

  readPkConfigFromForm() {
    const zipPathEl = document.getElementById('pkZipPath');
    const cfg = this.getDefaultPkConfig();
    if (zipPathEl) cfg.zipPath = zipPathEl.value || '';
    this.pkConfig = cfg;
    return cfg;
  }

  async syncPkConfigToBackend() {
    try {
      const payload = {
        enabled: !!this.pkEnabled,
        zipPath: this.pkConfig && this.pkConfig.zipPath ? this.pkConfig.zipPath : ''
      };
      const result = await window.electronAPI.setPkConfig(payload);
      if (!result || !result.success) {
        this.addLog(`同步PK配置到后端失败: ${(result && result.error) || '未知错误'}`, 'error');
      } else {
        this.addLog('单词PK自动化配置已应用', 'info');
      }
    } catch (e) {
      console.error('同步PK配置到后端失败:', e);
      this.addLog(`同步PK配置到后端失败: ${e.message}`, 'error');
    }
  }

  initEventListeners() {
    document.getElementById('clearPkCache').addEventListener('click', () => {
      this.handleClearCache();
    });

    const savePkBtn = document.getElementById('savePkConfig');
    if (savePkBtn) {
      savePkBtn.addEventListener('click', async () => {
        this.readPkConfigFromForm();
        this.savePkConfigToStorage(this.pkConfig);
        await this.syncPkConfigToBackend();
      });
    }

    const choosePkZipBtn = document.getElementById('choosePkZip');
    if (choosePkZipBtn) {
      choosePkZipBtn.addEventListener('click', () => {
        window.electronAPI.openPkZipChoosing();
      });
    }

    if (window.electronAPI.choosePkZip) {
      window.electronAPI.choosePkZip((filePath) => {
        if (!filePath) return;
        const zipPathEl = document.getElementById('pkZipPath');
        if (zipPathEl) {
          zipPathEl.value = filePath;
        }
        this.readPkConfigFromForm();
        this.savePkConfigToStorage(this.pkConfig);
        this.syncPkConfigToBackend().then(async () => {
          try {
            const backend = await window.electronAPI.getPkConfig();
            if (backend && backend.success && backend.config) {
              this.pkConfig = Object.assign(this.getDefaultPkConfig(), backend.config);
              this.applyPkConfigToForm();
            }
          } catch (e) {
            console.error('刷新PK配置失败:', e);
          }
        });
      });
    }

    const toggleBtn = document.getElementById('togglePkAuto');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        this.pkEnabled = !this.pkEnabled;
        await this.syncPkConfigToBackend();
        this.updateToggleButtonText();
      });
    }

    const importPkWordListBtn = document.getElementById('importPkWordListBtn');
    const importPkWordListInput = document.getElementById('importPkWordList');
    const importPkWordListStatus = document.getElementById('importPkWordListStatus');
    
    if (importPkWordListBtn && importPkWordListInput) {
      importPkWordListBtn.addEventListener('click', () => {
        importPkWordListInput.click();
      });
      
      importPkWordListInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.txt')) {
          importPkWordListStatus.textContent = '错误：请选择txt文件';
          importPkWordListStatus.style.color = '#dc3545';
          return;
        }
        
        importPkWordListStatus.textContent = '正在导入...';
        importPkWordListStatus.style.color = '#666';
        
        try {
          const fileContent = await file.text();
          const result = await window.electronAPI.importPkWordList(fileContent);
          
          if (result.success) {
            importPkWordListStatus.textContent = '导入成功';
            importPkWordListStatus.style.color = '#28a745';
            this.addLog('词库文件导入成功', 'success');
            setTimeout(() => {
              importPkWordListStatus.textContent = '';
            }, 3000);
          } else {
            importPkWordListStatus.textContent = `导入失败: ${result.error}`;
            importPkWordListStatus.style.color = '#dc3545';
            this.addLog(`词库文件导入失败: ${result.error}`, 'error');
          }
        } catch (error) {
          importPkWordListStatus.textContent = `导入失败: ${error.message}`;
          importPkWordListStatus.style.color = '#dc3545';
          this.addLog(`词库文件导入失败: ${error.message}`, 'error');
        }
        
        importPkWordListInput.value = '';
      });
    }
  }

  updateToggleButtonText() {
    const toggleBtn = document.getElementById('togglePkAuto');
    if (!toggleBtn) return;
    toggleBtn.textContent = this.pkEnabled ? '关闭单词PK自动化' : '开启单词PK自动化';
  }

  initIpcListeners() {
    // 监听PK注入相关事件
    window.electronAPI.onPkInjectionStart((data) => {
      this.injectionStatus = '注入中';
      const url = data?.url || '未知URL';
      this.addLog(`开始处理PK注入: ${url}`, 'info');
      this.updateStatus();
    });

    window.electronAPI.onPkInjectionSuccess((data) => {
      this.injectionStatus = '注入成功';
      this.processedRequests++;
      const message = data?.message || 'PK注入成功';
      this.addLog(`PK注入成功: ${message}`, 'success');
      this.updateStatus();
    });

    window.electronAPI.onPkInjectionError((data) => {
      this.injectionStatus = '注入失败';
      const error = data?.error || '未知错误';
      this.addLog(`PK注入失败: ${error}`, 'error');
      this.updateStatus();
    });

    window.electronAPI.onPkRequestProcessed((data) => {
      this.processedRequests++;
      const type = data?.type || '未知';
      const url = data?.url || '未知URL';
      this.addLog(`处理请求: ${type} - ${url}`, 'info');
      this.updateStatus();
    });
  }

  updateStatus() {
    const statusElement = document.getElementById('injection-status');
    const requestsElement = document.getElementById('processed-requests');
    
    if (statusElement) {
      statusElement.textContent = this.injectionStatus;
      statusElement.className = 'status-value';
      
      // 根据状态设置颜色
      if (this.injectionStatus === '注入成功') {
        statusElement.style.color = '#28a745';
      } else if (this.injectionStatus === '注入失败') {
        statusElement.style.color = '#dc3545';
      } else if (this.injectionStatus === '注入中') {
        statusElement.style.color = '#ffc107';
      } else {
        statusElement.style.color = '#007bff';
      }
    }
    
    if (requestsElement) {
      requestsElement.textContent = this.processedRequests;
    }
  }

  addLog(message, type = 'info') {
    const logContainer = document.getElementById('pk-injection-log');
    if (!logContainer) return;

    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // 限制日志条数，避免内存占用过多
    const entries = logContainer.querySelectorAll('.log-entry');
    if (entries.length > 100) {
      entries[0].remove();
    }
  }

  handleClearCache() {
    if (confirm(`警告：此操作将删除 ${pathJoin(cachePath, 'flipbooks')} 目录下的所有文件！\n\n确定要继续吗？`)) {
      this.addLog('正在删除flipbook文件夹...', 'info');
      
      const result = window.electronAPI.deleteFlipbooksFiles();
      
      if (result.error) {
        this.addLog(`删除失败: ${result.error}`, 'error');
      } else {
        this.addLog(`删除成功！已删除 ${result.deletedCount} 个文件/目录`, 'success');
      }
    }
  }
}

class HearingFeature {
  constructor() {
    this.initEventListeners();
  }

  initEventListeners() {
    document.getElementById('findAnswerPathBtn').addEventListener('click', () => {
      this.handleFindAnswerPath();
    });

    document.getElementById('getAnswerBtn').addEventListener('click', () => {
      this.handleGetAnswers();
    });

    document.getElementById('deleteFlipbooksBtn').addEventListener('click', () => {
      this.handleClearFlipbooks();
    });

    document.getElementById('replaceBtn').addEventListener('click', () => {
      this.handleReplaceAudio();
    });

    document.getElementById('restoreBtn').addEventListener('click', () => {
      this.handleRestoreAudio();
    });
  }

  handleFindAnswerPath() {
    const resultDiv = document.getElementById('answerResult');
    const folderPathInput = document.getElementById('answerFolderPath');

    resultDiv.innerHTML = `
      <strong>正在寻找可用路径...</strong><br>
      请稍候
    `;

    const result = window.electronAPI.getFlipbooksFolders();

    if (result.error) {
      resultDiv.innerHTML = `
        <strong>寻找失败</strong><br>
        错误信息: ${result.error}
      `;
    } else {
      if (result.folders.length === 0) {
        resultDiv.innerHTML = `
          <strong>未找到可用路径</strong><br>
          flipbooks目录下没有找到任何文件夹
        `;
      } else if (result.folders.length === 1) {
        folderPathInput.value = result.folders[0];
        resultDiv.innerHTML = `
          <strong>自动填写完成！</strong><br>
          找到1个文件夹：${result.folders[0]}<br>
          已自动填写到输入框中
        `;
      } else {
        resultDiv.innerHTML = `
          <strong>找到多个文件夹</strong><br>
          请从以下列表中选择一个：<br>
          ${result.folders.map(folder => `• ${folder}`).join('<br>')}<br>
          <br>
          请手动输入要使用的文件夹路径
        `;
      }
    }
  }

  handleGetAnswers() {
    const resultDiv = document.getElementById('answerResult');
    const folderPath = document.getElementById('answerFolderPath').value.trim();

    if (!folderPath) {
      resultDiv.innerHTML = `
        <strong>错误</strong><br>
        请输入文件夹路径
      `;
      return;
    }

    resultDiv.innerHTML = `
      <strong>正在获取听力答案...</strong><br>
      请稍候
    `;

    const result = window.electronAPI.getListeningAnswers(folderPath);

    if (result.error) {
      resultDiv.innerHTML = `
        <strong>获取失败</strong><br>
        错误信息: ${result.error}
      `;
    } else {
      let p2Content = '';
      if (Object.keys(result.P2).length > 0) {
        p2Content = '<strong>P2听后回答 - 音频标答文件：</strong><br>';
        for (const [className, files] of Object.entries(result.P2)) {
          p2Content += `<strong>${className}：</strong><br>`;
          files.forEach((file, index) => {
            const audioId = `audio_${className}_${index}`;
            p2Content += `
              <div style="margin: 10px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
                <div style="margin-bottom: 10px; font-weight: bold; color: #333;">音频 ${index + 1}：</div>
                <audio id="${audioId}" controls style="width: 100%; max-width: 500px; height: 40px; border-radius: 6px; background: #fff;">
                  <source src="file:///${file}" type="audio/mpeg">
                  您的浏览器不支持音频播放
                </audio>
                <div style="margin-top: 10px; font-size: 11px; color: #888; word-wrap: break-word; word-break: break-all; line-height: 1.4; background: #f5f5f5; padding: 8px; border-radius: 4px; border-left: 3px solid #007bff;">${file}</div>
              </div>
            `;
          });
          p2Content += '<br>';
        }
      } else {
        p2Content = '<strong>P2听后回答 - 音频标答文件：</strong> 未找到音频文件<br><br>';
      }

      let p3Content = '';
      if (result.P3.length > 0) {
        p3Content = '<strong>P3听后转述 - 听力标答：</strong><br>';
        result.P3.forEach((item, index) => {
          p3Content += `<strong>答案文件 ${index + 1}：</strong><br>`;
          p3Content += `<div style="font-size: 11px; color: #888; word-wrap: break-word; word-break: break-all; line-height: 1.4; background: #f5f5f5; padding: 8px; border-radius: 4px; border-left: 3px solid #28a745; margin: 5px 0;">${item.path}</div>`;
          if (item.error) {
            p3Content += `<div style="color: #dc3545; margin: 5px 0;">错误: ${item.error}</div>`;
          } else {
            if (item.data.Data.OriginalStandard) {
              p3Content += `
                <div style="margin: 10px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
                  <div style="margin-bottom: 10px; font-weight: bold; color: #333;">听力音频：</div>
              `;
              item.data.Data.OriginalStandard.forEach((item1, index) => {
                p3Content += `<p>${item1}</p>`;
              });
              p3Content += `
                </div>
              `;
            }
            if (item.data.Data.OriginalReference) {
              p3Content += `
                <div style="margin: 10px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
                  <div style="margin-bottom: 10px; font-weight: bold; color: #333;">参考答案：</div>
              `;
              item.data.Data.OriginalReference.forEach((item1, index) => {
                p3Content += `<p>${item1}</p>`;
              });
              p3Content += `
                </div>
              `;
            }
          }
          p3Content += '<br>';
        });
      } else {
        p3Content = '<strong>P3听后转述 - 听力标答：</strong> 未找到听力标答文件<br>';
      }

      resultDiv.innerHTML = `
        <strong>获取成功！</strong><br>
        已找到听力答案数据<br><br>
        ${p2Content}
        ${p3Content}
      `;
    }
  }

  handleClearFlipbooks() {
    const resultDiv = document.getElementById('answerResult');

    if (confirm(`警告：此操作将清理 ${pathJoin(cachePath, 'flipbooks')} 目录下的所有文件！\n\n确定要继续吗？`)) {
      resultDiv.innerHTML = `
        <strong>正在清理文件...</strong><br>
        请稍候
      `;

      const result = window.electronAPI.deleteFlipbooksFiles();

      if (result.error) {
        resultDiv.innerHTML = `
          <strong>清理失败</strong><br>
          错误信息: ${result.error}
        `;
      } else {
        resultDiv.innerHTML = `
          <strong>清理成功！</strong><br>
          已清理 ${result.deletedCount} 个文件/目录<br>
          <br>
          <strong>操作完成</strong>
        `;
      }
    }
  }

  handleDeleteFlipbooks() {
    const resultDiv = document.getElementById('answerResult');

    if (confirm(`警告：此操作将删除 ${pathJoin(cachePath, 'flipbooks')} 目录下的所有文件！\n\n确定要继续吗？`)) {
      resultDiv.innerHTML = `
        <strong>正在删除文件...</strong><br>
        请稍候
      `;

      const result = window.electronAPI.deleteFlipbooksFiles();

      if (result.error) {
        resultDiv.innerHTML = `
          <strong>删除失败</strong><br>
          错误信息: ${result.error}
        `;
      } else {
        resultDiv.innerHTML = `
          <strong>删除成功！</strong><br>
          已删除 ${result.deletedCount} 个文件/目录<br>
          <br>
          <strong>操作完成</strong>
        `;
      }
    }
  }

  handleReplaceAudio() {
    const resultDiv = document.getElementById('answerResult');
    const folderPath = document.getElementById('answerFolderPath').value.trim();

    if (!folderPath) {
      resultDiv.innerHTML = `
        <strong>错误</strong><br>
        请输入文件夹路径
      `;
      return;
    }

    if (confirm(`警告：此操作将替换 ${pathJoin(cachePath, 'flipbooks', folderPath, 'bookres', 'media')} 目录下的所有MP3文件！\n\n确定要继续吗？`)) {
      resultDiv.innerHTML = `
        <strong>正在替换音频文件...</strong><br>
        请稍候
      `;

      const result = window.electronAPI.replaceAudioFiles(folderPath);

      if (result.error) {
        resultDiv.innerHTML = `
          <strong>替换失败</strong><br>
          错误信息: ${result.error}
        `;
      } else {
        resultDiv.innerHTML = `
          <strong>替换成功！</strong><br>
          已替换 ${result.replacedCount} 个音频文件<br>
          <br>
          <strong>现在可以：</strong><br>
          1. 进行听力练习<br>
          2. 完成后点击"还原音频"按钮恢复原文件
        `;
      }
    }
  }

  handleRestoreAudio() {
    const resultDiv = document.getElementById('answerResult');
    const folderPath = document.getElementById('answerFolderPath').value.trim();

    if (!folderPath) {
      resultDiv.innerHTML = `
        <strong>错误</strong><br>
        请输入文件夹路径
      `;
      return;
    }

    if (confirm(`确定要还原 ${pathJoin(cachePath, 'flipbooks', folderPath, 'bookres', 'media')} 目录下的音频文件吗？`)) {
      resultDiv.innerHTML = `
        <strong>正在还原音频文件...</strong><br>
        请稍候
      `;

      const result = window.electronAPI.restoreAudioFiles(folderPath);

      if (result.error) {
        resultDiv.innerHTML = `
          <strong>还原失败</strong><br>
          错误信息: ${result.error}
        `;
      } else {
        resultDiv.innerHTML = `
          <strong>还原成功！</strong><br>
          已还原 ${result.restoredCount} 个音频文件<br>
          <br>
          <strong>操作完成</strong>
        `;
      }
    }
  }
}

// 初始化所有功能类已移至文件末尾
class UniversalAnswerFeature {
  constructor() {
    this.isProxyRunning = false;
    this.isCapturing = false;
    this.sortMode = 'file';
    this.lastAnswersData = null;
    this.initEventListeners();
    this.initIpcListeners();
    this.initImportAnswer()
  }

  initEventListeners() {
    document.getElementById('startProxyBtn').addEventListener('click', () => {
      this.startProxy();
    });

    document.getElementById('stopProxyBtn').addEventListener('click', () => {
      this.stopProxy();
    });

    document.getElementById('deleteTempBtn').addEventListener('click', () => {
      this.handleDeleteTemp();
    });

    document.getElementById('testRulesBtn').addEventListener('click', () => {
      this.testRulesFunction();
    });

    document.getElementById('sortMode').addEventListener('change', (e) => {
      this.sortMode = e.target.value;
      const container = document.getElementById('answersContainer');
      if (container.innerHTML && !container.innerHTML.includes('暂无答案数据')) {
        const answersData = this.lastAnswersData;
        if (answersData) {
          this.displayAnswers(answersData);
        }
      }
    });
  }

  initIpcListeners() {


    // 监听代理状态
    window.electronAPI.onProxyStatus((event, data) => {
      this.updateProxyStatus(data);
    });

    // 监听证书状态
    window.electronAPI.onCertificateStatus((event, data) => {
      this.updateCertificateStatus(data);
    });

    // 监听流量日志
    window.electronAPI.onTrafficLog((event, data) => {
      this.addTrafficLog(data);
    });

    // 监听响应捕获
    window.electronAPI.onResponseCaptured((event, data) => {
      this.addTrafficLog(data);
    });

    // 监听响应错误
    window.electronAPI.onResponseError((event, data) => {
      this.addErrorLog(`响应错误: ${data.error} - ${data.url}`);
    });

    // 监听重要请求
    window.electronAPI.onImportantRequest((event, data) => {
      this.addImportantLog(data);
    });

    // 监听下载发现
    window.electronAPI.onDownloadFound((event, data) => {
      this.addSuccessLog(`发现下载链接: ${data.url}`);
    });

    // 监听处理状态
    window.electronAPI.onProcessStatus((event, data) => {
      this.updateProcessStatus(data);
    });

    // 监听处理错误
    window.electronAPI.onProcessError((event, data) => {
      this.addErrorLog(data.error);
    });

    // 监听答案提取
    window.electronAPI.onAnswersExtracted((event, data) => {
      this.displayAnswers(data);
    });

    // 监听捕获状态
    window.electronAPI.onCaptureStatus((event, data) => {
      this.updateCaptureStatus(data);
    });

    // 监听代理错误
    window.electronAPI.onProxyError((event, data) => {
      this.addErrorLog(data.message);
      // 如果代理出错，重置按钮状态
      const startBtn = document.getElementById('startProxyBtn');
      const stopBtn = document.getElementById('stopProxyBtn');
      const captureBtn = document.getElementById('startCaptureBtn');

      startBtn.disabled = false;
      stopBtn.disabled = true;
      captureBtn.disabled = true;

      this.isProxyRunning = false;
      this.updateProxyStatus({ running: false, message: '代理服务器出错' });
    });

    // 监听文件结构
    window.electronAPI.onFileStructure((event, data) => {
      this.displayFileStructure(data);
    });

    // 监听文件处理结果
    window.electronAPI.onFilesProcessed((event, data) => {
      this.displayProcessedFiles(data);
    });
  }

  startProxy() {
    const startBtn = document.getElementById('startProxyBtn');
    const stopBtn = document.getElementById('stopProxyBtn');

    // 更新按钮状态，防止重复点击
    startBtn.disabled = true;
    stopBtn.disabled = false;

    window.electronAPI.startAnswerProxy();
    this.addInfoLog('正在启动代理服务器...');

    // 设置超时检查，如果代理没有启动，恢复按钮状态
    setTimeout(() => {
      if (!this.isProxyRunning) {
        this.addErrorLog('代理服务器启动超时，请检查网络或端口占用');
        startBtn.disabled = false;
        stopBtn.disabled = true;
      } else {
        this.addInfoLog('代理服务器启动成功，自动开始监听网络请求...');
        window.electronAPI.startCapturing();
      }
    }, 5000);
  }

  stopProxy() {
    const startBtn = document.getElementById('startProxyBtn');
    const stopBtn = document.getElementById('stopProxyBtn');

    // 更新按钮状态，防止重复点击
    startBtn.disabled = true;
    stopBtn.disabled = true;

    window.electronAPI.stopAnswerProxy();
    this.addInfoLog('正在停止代理服务器...');

    // 设置超时检查，如果代理没有停止，恢复按钮状态
    setTimeout(() => {
      if (this.isProxyRunning) {
        this.addErrorLog('代理服务器停止超时，请尝试手动关闭');
        startBtn.disabled = false;
        stopBtn.disabled = false;
      }
    }, 5000);
  }

  updateProxyStatus(data) {
    const statusElement = document.getElementById('proxyStatus');
    const startBtn = document.getElementById('startProxyBtn');
    const stopBtn = document.getElementById('stopProxyBtn');

    if (data.running) {
      this.isProxyRunning = true;
      statusElement.textContent = '运行中';
      statusElement.className = 'status-value running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      this.addSuccessLog(data.message);
    } else {
      this.isProxyRunning = false;
      statusElement.textContent = '已停止';
      statusElement.className = 'status-value stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      this.addInfoLog(data.message);
    }
  }

  updateCertificateStatus(data) {
    const statusElement = document.getElementById('certificateStatus');

    if (data.status === 'importing') {
      statusElement.textContent = '导入中';
      statusElement.className = 'status-value processing';
      this.addInfoLog(data.message);
    } else if (data.status === 'success') {
      statusElement.textContent = '已导入';
      statusElement.className = 'status-value success';
      this.addSuccessLog(data.message);
    } else if (data.status === 'error') {
      statusElement.textContent = '导入失败';
      statusElement.className = 'status-value error';
      this.addErrorLog(data.message);
    } else if (data.status === 'exists') {
      statusElement.textContent = '已存在';
      statusElement.className = 'status-value success';
      this.addSuccessLog(data.message);
    } else if (data.status === 'not_found') {
      statusElement.textContent = '未找到';
      statusElement.className = 'status-value error';
      this.addErrorLog(data.message);
    }
  }

  updateCaptureStatus(data) {
    const statusElement = document.getElementById('captureStatus');
    const startBtn = document.getElementById('startCaptureBtn');
    const stopBtn = document.getElementById('stopCaptureBtn');

    if (data.capturing) {
      this.isCapturing = true;
      statusElement.textContent = '监听中';
      statusElement.className = 'status-value running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      this.addSuccessLog('网络监听已启动');
    } else {
      this.isCapturing = false;
      statusElement.textContent = '未开始';
      statusElement.className = 'status-value stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      this.addInfoLog('网络监听已停止');
    }
  }

  updateProcessStatus(data) {
    const statusElement = document.getElementById('processStatus');

    if (data.status === 'downloading') {
      statusElement.textContent = '下载中';
      statusElement.className = 'status-value processing';
    } else if (data.status === 'extracting') {
      statusElement.textContent = '解压中';
      statusElement.className = 'status-value processing';
    } else if (data.status === 'processing') {
      statusElement.textContent = '处理中';
      statusElement.className = 'status-value processing';
    }

    this.addInfoLog(data.message);
  }

  addTrafficLog(data) {
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    const method = data.method || 'UNKNOWN';
    const url = data.url || 'Unknown URL';

    // 创建可展开的日志项
    const logItem = document.createElement('div');
    logItem.className = `log-item request-item ${method.toLowerCase()}`;

    // 创建请求行
    const requestLine = document.createElement('div');
    requestLine.className = 'request-line';

    // 添加状态码显示
    let statusDisplay = '';
    if (data.statusCode) {
      const statusClass = data.statusCode >= 200 && data.statusCode < 300 ? 'success' :
        data.statusCode >= 400 ? 'error' : 'warning';
      statusDisplay = ` <span class="status-${statusClass}">[${data.statusCode}]</span>`;
    }

    // 格式化URL确保完整显示，并修复重复协议问题
    let formattedUrl = this.formatUrl(url);
    // 修复URL重复问题，例如 http://fs.up366.cnhttp://fs.up366.cn/download/xxx
    formattedUrl = formattedUrl.replace(/(https?:\/\/[^\/]+)\1+/, '$1');

    requestLine.innerHTML = `<span class="log-method ${method}">${method} [${timestamp}]</span>${statusDisplay} ${formattedUrl}`;
    logItem.appendChild(requestLine);

    // 创建详情容器（默认隐藏）
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'request-details';
    detailsContainer.style.display = 'none';

    // 添加时间戳
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'detail-item';
    timestampDiv.innerHTML = `<strong>时间:</strong> ${timestamp}`;
    detailsContainer.appendChild(timestampDiv);

    // 添加主机信息
    if (data.host) {
      const hostDiv = document.createElement('div');
      hostDiv.className = 'detail-item';
      hostDiv.innerHTML = `<strong>主机:</strong> ${data.host}`;
      detailsContainer.appendChild(hostDiv);
    }

    // 添加协议信息
    if (data.isHttps !== undefined) {
      const protocolDiv = document.createElement('div');
      protocolDiv.className = 'detail-item';
      protocolDiv.innerHTML = `<strong>协议:</strong> ${data.isHttps ? 'HTTPS' : 'HTTP'}`;
      detailsContainer.appendChild(protocolDiv);
    }

    // 添加请求头
    if (data.requestHeaders) {
      const headersDiv = document.createElement('div');
      headersDiv.className = 'detail-item';
      headersDiv.innerHTML = `<strong>请求头:</strong><pre class="headers">${JSON.stringify(data.requestHeaders, null, 2)}</pre>`;
      detailsContainer.appendChild(headersDiv);
    }

    // 添加Cookie（从请求头中提取）
    if (data.requestHeaders && data.requestHeaders.cookie) {
      const cookiesDiv = document.createElement('div');
      cookiesDiv.className = 'detail-item';
      cookiesDiv.innerHTML = `<strong>Cookie:</strong><pre class="cookies">${data.requestHeaders.cookie}</pre>`;
      detailsContainer.appendChild(cookiesDiv);
    }

    // 添加请求体（如果有）
    if (data.requestBody) {
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'detail-item';
      bodyDiv.innerHTML = `<strong>请求体:</strong><pre class="request-body">${this.formatBody(data.requestBody)}</pre>`;
      detailsContainer.appendChild(bodyDiv);
    }

    // 添加响应状态（如果有）
    if (data.statusCode) {
      const statusDiv = document.createElement('div');
      statusDiv.className = 'detail-item';
      const statusClass = data.statusCode >= 200 && data.statusCode < 300 ? 'success' :
        data.statusCode >= 400 ? 'error' : 'warning';
      statusDiv.innerHTML = `<strong>响应状态:</strong> <span class="status-${statusClass}">${data.statusCode} ${data.statusMessage || ''}</span>`;
      detailsContainer.appendChild(statusDiv);
    }

    // 添加响应头
    if (data.responseHeaders) {
      const responseHeadersDiv = document.createElement('div');
      responseHeadersDiv.className = 'detail-item';
      responseHeadersDiv.innerHTML = `<strong>响应头:</strong><pre class="response-headers">${JSON.stringify(data.responseHeaders, null, 2)}</pre>`;
      detailsContainer.appendChild(responseHeadersDiv);
    }

    // 添加内容类型（如果有）
    if (data.contentType) {
      const contentTypeDiv = document.createElement('div');
      contentTypeDiv.className = 'detail-item';
      contentTypeDiv.innerHTML = `<strong>内容类型:</strong> ${data.contentType}`;
      detailsContainer.appendChild(contentTypeDiv);
    }

    // 添加响应体
    if (data.responseBody) {
      const responseBodyDiv = document.createElement('div');
      responseBodyDiv.className = 'detail-item';

      const responseBodyContainer = document.createElement('div');
      responseBodyContainer.className = 'response-body-container';

      const responseBodyPreview = document.createElement('pre');
      responseBodyPreview.className = 'response-body';
      responseBodyPreview.textContent = this.formatBody(data.responseBody);

      const downloadContainer = document.createElement('div');
      downloadContainer.style.position = 'absolute';
      downloadContainer.style.right = '5px';
      downloadContainer.style.top = '5px';

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'download-response-btn';
      downloadBtn.textContent = '下载';
      downloadBtn.style.padding = '3px 8px';
      downloadBtn.style.fontSize = '11px';
      downloadBtn.style.marginLeft = '5px';

      downloadBtn.addEventListener('click', () => {
        this.downloadResponse(data.uuid);
      });

      downloadContainer.appendChild(downloadBtn);
      responseBodyContainer.appendChild(responseBodyPreview);
      responseBodyContainer.appendChild(downloadContainer);

      responseBodyDiv.innerHTML = '<strong>响应体:</strong>';
      responseBodyDiv.appendChild(responseBodyContainer);
      detailsContainer.appendChild(responseBodyDiv);
    }

    // 添加响应体大小（如果有）
    if (data.bodySize) {
      const bodySizeDiv = document.createElement('div');
      bodySizeDiv.className = 'detail-item';
      bodySizeDiv.innerHTML = `<strong>响应体大小:</strong> ${this.formatFileSize(data.bodySize)}`;
      detailsContainer.appendChild(bodySizeDiv);
    }

    // 添加错误信息（如果有）
    if (data.error) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'detail-item error';
      errorDiv.innerHTML = `<strong>错误:</strong> <span class="error-text">${data.error}</span>`;
      detailsContainer.appendChild(errorDiv);
    }

    logItem.appendChild(detailsContainer);

    // 添加点击事件以展开/折叠详情
    requestLine.addEventListener('click', () => {
      detailsContainer.style.display = detailsContainer.style.display === 'none' ? 'block' : 'none';
      requestLine.classList.toggle('expanded');
    });

    const trafficLog = document.getElementById('trafficLog');
    trafficLog.appendChild(logItem);
    trafficLog.scrollTop = trafficLog.scrollHeight;

    // 限制日志数量
    const logItems = trafficLog.querySelectorAll('.log-item');
    if (logItems.length > 100) {
      trafficLog.removeChild(logItems[0]);
    }
  }

  // 格式化请求/响应体
  formatBody(body) {
    if (!body) return '';

    // 限制显示长度
    const maxLength = 5000;
    let displayBody = body.length > maxLength ? body.substring(0, maxLength) + '\n[内容过长，已截断...]' : body;

    // 尝试格式化JSON
    try {
      if (displayBody.trim().startsWith('{') || displayBody.trim().startsWith('[')) {
        const parsed = JSON.parse(displayBody);
        return JSON.stringify(parsed, null, 2);
      }
    } catch (e) {
      // 不是JSON，返回原始内容
    }

    return displayBody;
  }

  // 格式化URL，确保显示完整URL
  formatUrl(url) {
    if (!url) return '';

    // 如果URL不包含协议，尝试补充
    if (!url.match(/^https?:\/\//)) {
      try {
        const parsed = new URL(url);
        if (!parsed.protocol) {
          // 如果没有协议，根据是否为HTTPS添加协议
          const isHttps = url.includes(':443') || url.includes(':8443') ||
            (url.includes('fs.') && !url.includes(':80'));
          const protocol = isHttps ? 'https://' : 'http://';
          url = protocol + url.replace(/^\//, '');
        }
      } catch (e) {
        // URL解析失败，返回原始URL
        return url;
      }
    }

    return url;
  }

  // 格式化文件大小
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
    return Math.round(bytes / (1024 * 1024)) + 'MB';
  }

  addImportantLog(data) {
    const logText = `[重要] ${data.url} - 包含关键数据`;
    this.addLogItem(logText, 'important');
  }

  addSuccessLog(message) {
    this.addLogItem(`[成功] ${message}`, 'success');
  }

  addErrorLog(message) {
    this.addLogItem(`[错误] ${message}`, 'error');
  }

  addInfoLog(message) {
    this.addLogItem(`[信息] ${message}`, 'normal');
  }

  addLogItem(text, type) {
    const trafficLog = document.getElementById('trafficLog');
    const logItem = document.createElement('div');
    logItem.className = `log-item ${type}`;
    logItem.textContent = text;

    trafficLog.appendChild(logItem);
    trafficLog.scrollTop = trafficLog.scrollHeight;

    // 限制日志数量
    const logItems = trafficLog.querySelectorAll('.log-item');
    if (logItems.length > 100) {
      trafficLog.removeChild(logItems[0]);
    }
  }

  displayFileStructure(data) {
    this.addInfoLog(`文件结构分析完成，解压目录: ${data.extractDir}`);

    // 可以在这里添加文件结构的可视化显示
    const structureInfo = this.formatFileStructure(data.structure);
    this.addInfoLog(`文件结构: ${structureInfo}`);
  }

  async downloadResponse(uuid) {
    let res = await window.electronAPI.downloadFile(uuid)
    if (res == 1) {
      this.addSuccessLog(`响应体下载成功`);
    } else if (res == 0) {
      this.addErrorLog(`响应体下载失败`);
    }
  }

  displayProcessedFiles(data) {
    this.addInfoLog(`文件处理完成，共处理 ${data.processedFiles.length} 个文件，提取到 ${data.totalAnswers} 个答案`);

    // 显示每个文件的处理结果
    data.processedFiles.forEach(file => {
      if (file.success) {
        this.addSuccessLog(`✓ ${file.file}: 提取到 ${file.answerCount} 个答案`);
      } else {
        this.addErrorLog(`✗ ${file.file}: ${file.error}`);
      }
    });
  }

  formatFileStructure(structure, depth = 0) {
    const indent = '  '.repeat(depth);
    let result = `${indent}${structure.name}`;

    if (structure.type === 'file') {
      result += ` (${structure.ext}, ${this.formatFileSize(structure.size)})`;
    }

    if (structure.children && structure.children.length > 0) {
      const childrenInfo = structure.children.slice(0, 3).map(child =>
        this.formatFileStructure(child, depth + 1)
      ).join(', ');

      if (structure.children.length > 3) {
        result += ` [${structure.children.length} items: ${childrenInfo}, ...]`;
      } else {
        result += ` [${childrenInfo}]`;
      }
    }

    return result;
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
    return Math.round(bytes / (1024 * 1024)) + 'MB';
  }

  displayAnswers(data) {
    const container = document.getElementById('answersContainer');
    const processStatus = document.getElementById('processStatus');

    this.copyToClipboard = function (text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = 0;
      document.body.appendChild(textarea);
      textarea.select();

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          const toast = document.createElement('div');
          toast.className = 'copy-toast show';
          toast.textContent = '答案已复制到剪贴板！';
          document.body.appendChild(toast);

          setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
              document.body.removeChild(toast);
            }, 300);
          }, 2000);
        }
      } catch (err) {
        console.error('复制失败:', err);
        const toast = document.createElement('div');
        toast.className = 'copy-toast error show';
        toast.textContent = '复制失败，请手动复制';
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => {
            document.body.removeChild(toast);
          }, 300);
        }, 2000);
      }
      document.body.removeChild(textarea);
    };
    processStatus.textContent = '完成';
    processStatus.className = 'status-value running';

    // 清空容器
    container.innerHTML = '';

    if (data.answers.length === 0) {
      container.innerHTML = '<div class="no-answers">未找到答案数据</div>';
      return;
    }

    this.lastAnswersData = data;

    const patternOrder = {
      '听后选择': 1,
      '听后回答': 2,
      '听后转述': 3,
      '朗读短文': 4,
      '分析内容': 5,
      'JSON句子跟读模式': 6,
      'JSON单词发音模式': 7,
      'JSON答案数组模式': 8,
      'JSON题目模式': 9,
      '文本答案模式': 10,
      '文本选项模式': 11,
      'XML正确答案模式': 12,
      'XML题目答案模式': 13,
      '通用XML答案模式': 14
    };

    if (this.sortMode === 'file') {
      const answersByFile = {};
      data.answers.forEach(answer => {
        const sourceFile = answer.sourceFile || '未知文件';
        if (!answersByFile[sourceFile]) {
          answersByFile[sourceFile] = [];
        }
        answersByFile[sourceFile].push(answer);
      });
      Object.keys(answersByFile).forEach(sourceFile => {
        const fileSection = document.createElement('div');
        fileSection.className = 'file-section';

        const fileHeader = document.createElement('div');
        fileHeader.className = 'file-header';
        fileHeader.innerHTML = `
          <h4>📁 ${sourceFile}</h4>
          <span class="answer-count">${answersByFile[sourceFile].length} 个答案</span>
        `;
        fileSection.appendChild(fileHeader);

        // 按题型排序答案
        const sortedAnswers = answersByFile[sourceFile].sort((a, b) => {
          const patternA = patternOrder[a.pattern] || 99;
          const patternB = patternOrder[b.pattern] || 99;
          return patternA - patternB;
        });

        this.createAnswerDisplay = (answer) => {
          const answerItem = document.createElement('div');
          answerItem.className = 'answer-item';

          const answerNumber = document.createElement('div');
          answerNumber.className = 'answer-number';
          answerNumber.textContent = answer.question;

          const answerOption = document.createElement('div');
          answerOption.className = 'answer-option';
          answerOption.textContent = answer.answer;

          const answerContent = document.createElement('div');
          answerContent.className = 'answer-content';
          answerContent.textContent = answer.content || '暂无内容';

          answerContent.style.textAlign = 'center';
          answerContent.style.color = '#007bff';
          answerContent.style.fontWeight = 'bold';
          answerContent.style.padding = '8px';
          answerContent.style.borderRadius = '4px';
          answerContent.style.backgroundColor = '#e6f2ff';
          answerContent.style.cursor = 'pointer';
          answerContent.style.transition = 'all 0.3s ease';

          const answerPattern = document.createElement('div');
          answerPattern.className = 'answer-pattern';
          answerPattern.textContent = `提取模式: ${answer.pattern}`;

          const copyBtn = document.createElement('div');
          copyBtn.className = 'copy-btn';
          copyBtn.innerHTML = '📋 复制';
          copyBtn.title = '点击复制答案';

          answerOption.dataset.answer = answer.answer;
          answerContent.dataset.answer = answer.content || '暂无内容';

          answerOption.addEventListener('click', () => {
            this.copyToClipboard(answer.answer);
          });

          answerContent.addEventListener('click', () => {
            this.copyToClipboard(answer.content || '暂无内容');
          });

          copyBtn.addEventListener('click', () => {
            const fullAnswer = `${answer.answer}\n${answer.content || ''}`.trim();
            this.copyToClipboard(fullAnswer);
          });

          // 组装答案元素
          answerItem.appendChild(answerNumber);
          answerItem.appendChild(answerOption);
          answerItem.appendChild(answerContent);
          if (answer.pattern) {
            answerItem.appendChild(answerPattern);
          }
          answerItem.appendChild(copyBtn);

          if (answer.children) {
            const childrenItem = document.createElement('div');
            childrenItem.className = 'children';
            childrenItem.style.display = 'none';
            answer.children.forEach(child => {
              childrenItem.appendChild(this.createAnswerDisplay(child))
            })
            answerItem.appendChild(childrenItem);
            answerContent.style.cursor = 'pointer'
            answerContent.addEventListener('click', () => {
              if (childrenItem.style.display == 'none') {
                childrenItem.style.display = 'block';
                answerContent.textContent = '点击收起全部回答';
              } else {
                childrenItem.style.display = 'none';
                answerContent.textContent = '点击展开全部回答';
              }
            })
          }

          return answerItem
        }

        sortedAnswers.forEach(answer => {
          fileSection.appendChild(this.createAnswerDisplay(answer));
        });

        container.appendChild(fileSection);
      });

      this.addSuccessLog(`答案提取完成！共 ${data.count} 题，来自 ${Object.keys(answersByFile).length} 个文件，已保存到: ${data.file}`);
    } else {
      const answersByPattern = {};
      data.answers.forEach(answer => {
        const pattern = answer.pattern || '未知题型';
        if (!answersByPattern[pattern]) {
          answersByPattern[pattern] = [];
        }
        answersByPattern[pattern].push(answer);
      });

      Object.keys(patternOrder).forEach(pattern => {
        if (answersByPattern[pattern]) {
          const patternSection = document.createElement('div');
          patternSection.className = 'pattern-section';

          const patternHeader = document.createElement('div');
          patternHeader.className = 'pattern-header';
          patternHeader.innerHTML = `
            <h4>📝 ${pattern}</h4>
            <span class="answer-count">${answersByPattern[pattern].length} 个答案</span>
          `;
          patternSection.appendChild(patternHeader);

          const sortedAnswers = answersByPattern[pattern].sort((a, b) => {
            const fileA = a.sourceFile || '未知文件';
            const fileB = b.sourceFile || '未知文件';
            return fileA.localeCompare(fileB);
          });

          this.createAnswerDisplay = (answer) => {
            const answerItem = document.createElement('div');
            answerItem.className = 'answer-item';

            const answerNumber = document.createElement('div');
            answerNumber.className = 'answer-number';
            answerNumber.textContent = answer.question;

            const answerOption = document.createElement('div');
            answerOption.className = 'answer-option';
            answerOption.textContent = answer.answer;

            const answerContent = document.createElement('div');
            answerContent.className = 'answer-content';
            answerContent.textContent = answer.content || '暂无内容';

            answerContent.style.textAlign = 'center';
            answerContent.style.color = '#007bff';
            answerContent.style.fontWeight = 'bold';
            answerContent.style.padding = '8px';
            answerContent.style.borderRadius = '4px';
            answerContent.style.backgroundColor = '#e6f2ff';
            answerContent.style.cursor = 'pointer';
            answerContent.style.transition = 'all 0.3s ease';

            const answerSource = document.createElement('div');
            answerSource.className = 'answer-source';
            answerSource.textContent = `来源: ${answer.sourceFile}`;

            const copyBtn = document.createElement('div');
            copyBtn.className = 'copy-btn';
            copyBtn.innerHTML = '📋 复制';
            copyBtn.title = '点击复制答案';

            answerOption.dataset.answer = answer.answer;
            answerContent.dataset.answer = answer.content || '暂无内容';

            answerOption.addEventListener('click', () => {
              this.copyToClipboard(answer.answer);
            });

            answerContent.addEventListener('click', () => {
              this.copyToClipboard(answer.content || '暂无内容');
            });

            copyBtn.addEventListener('click', () => {
              const fullAnswer = `${answer.answer}\n${answer.content || ''}`.trim();
              this.copyToClipboard(fullAnswer);
            });

            answerItem.appendChild(answerNumber);
            answerItem.appendChild(answerOption);
            answerItem.appendChild(answerContent);
            if (answer.sourceFile) {
              answerItem.appendChild(answerSource);
            }
            answerItem.appendChild(copyBtn);

            if (answer.children) {
              const childrenItem = document.createElement('div');
              childrenItem.className = 'children';
              childrenItem.style.display = 'none';
              answer.children.forEach(child => {
                childrenItem.appendChild(this.createAnswerDisplay(child))
              })
              answerItem.appendChild(childrenItem);
              answerContent.style.cursor = 'pointer'
              answerContent.addEventListener('click', () => {
                if (childrenItem.style.display == 'none') {
                  childrenItem.style.display = 'block';
                  answerContent.textContent = '点击收起全部回答';
                } else {
                  childrenItem.style.display = 'none';
                  answerContent.textContent = '点击展开全部回答';
                }
              })
            }

            return answerItem
          }

          sortedAnswers.forEach(answer => {
            patternSection.appendChild(this.createAnswerDisplay(answer));
          });

          container.appendChild(patternSection);
        }
      });

      this.addSuccessLog(`答案提取完成！共 ${data.count} 题，按题型排序显示，已保存到: ${data.file}`);
    }
  }

  handleDeleteTemp() {
    const resultDiv = document.getElementById('trafficLog');

    if (confirm('确定要删除临时缓存文件夹吗？此操作将删除所有已下载的缓存文件。')) {
      resultDiv.innerHTML = `
        <div class="log-item">正在删除临时缓存文件夹...</div>
      `;

      window.electronAPI.clearCache().then(result => {
        if (result) {
          resultDiv.innerHTML = `<div class="log-item success">缓存清理成功</div>`;
        } else {
          resultDiv.innerHTML = `<div class="log-item error">缓存清理失败</div>`;
        }
      });
    }
  }

  initImportAnswer() {
    document.getElementById('importAnswer').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          try {
            const answersData = JSON.parse(content);
            this.displayAnswers(answersData);
          } catch (error) {
            console.error(error)
            alert('解析答案文件失败')
          }
          event.target.value = '';
        };
        reader.readAsText(file);
      }
    });

    document.getElementById('clearAnswersBtn').addEventListener('click', () => {
      const container = document.getElementById('answersContainer');

      container.innerHTML = `<div class="no-answers">暂无答案数据</div>`;

      this.lastAnswersData = null;

      const toast = document.createElement('div');
      toast.className = 'copy-toast show';
      toast.textContent = '已清空提取结果';
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(toast);
        }, 300);
      }, 2000);
    });

    document.getElementById('shareAnswerBtn').addEventListener('click', () => {
      this.handleShareAnswer();
    });
  }

  async handleShareAnswer() {
    if (!this.lastAnswersData || !this.lastAnswersData.file) {
      this.addErrorLog('没有可分享的答案文件');
      return;
    }

    const shareBtn = document.getElementById('shareAnswerBtn');
    shareBtn.disabled = true;
    shareBtn.textContent = '上传中...';

    try {
      const result = await window.electronAPI.shareAnswerFile(this.lastAnswersData.file);

      if (result.success) {
        const downloadUrl = result.downloadUrl;
        const primaryUrl = `https://366.cyril.qzz.io/?url=${encodeURIComponent(downloadUrl)}`;
        const backupUrl = `https://a366.netlify.app/?url=${encodeURIComponent(downloadUrl)}`;

        const shareModal = document.createElement('div');
        shareModal.className = 'share-modal';
        shareModal.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10000;
        `;

        const shareContent = document.createElement('div');
        shareContent.style.cssText = `
          background: white;
          padding: 30px;
          border-radius: 8px;
          max-width: 600px;
          width: 90%;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        shareContent.innerHTML = `
          <h3 style="margin-top: 0; color: #333;">答案文件分享成功！</h3>
          <p style="color: #666; margin-bottom: 20px;">请复制以下链接分享给他人：</p>
          <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: bold;">主网址：</label>
            <div style="display: flex; gap: 10px;">
              <input type="text" id="primaryUrl" value="${primaryUrl}" readonly 
                     style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
              <button class="copy-url-btn" data-url="${primaryUrl}" 
                      style="padding: 8px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                复制
              </button>
            </div>
          </div>
          <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: bold;">备用网址：</label>
            <div style="display: flex; gap: 10px;">
              <input type="text" id="backupUrl" value="${backupUrl}" readonly 
                     style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
              <button class="copy-url-btn" data-url="${backupUrl}" 
                      style="padding: 8px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                复制
              </button>
            </div>
          </div>
          <button id="closeShareModal" 
                  style="width: 100%; padding: 10px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
            关闭
          </button>
        `;

        shareModal.appendChild(shareContent);
        document.body.appendChild(shareModal);

        shareContent.querySelectorAll('.copy-url-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const url = btn.getAttribute('data-url');
            this.copyToClipboard(url);
            btn.textContent = '已复制！';
            setTimeout(() => {
              btn.textContent = '复制';
            }, 2000);
          });
        });

        document.getElementById('closeShareModal').addEventListener('click', () => {
          document.body.removeChild(shareModal);
        });

        shareModal.addEventListener('click', (e) => {
          if (e.target === shareModal) {
            document.body.removeChild(shareModal);
          }
        });

        this.addSuccessLog('答案文件上传成功，分享链接已生成');
      } else {
        this.addErrorLog(`上传失败: ${result.error}`);
        alert(`上传失败: ${result.error}`);
      }
    } catch (error) {
      console.error('分享答案文件失败:', error);
      this.addErrorLog(`分享失败: ${error.message}`);
      alert(`分享失败: ${error.message}`);
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = '分享答案';
    }
  }
}

// 初始化代码
document.addEventListener('DOMContentLoaded', () => {
  new Global();
  new MainMenu();
  new ListeningFeature();
  new WordPKFeature();
  new HearingFeature();
  new UniversalAnswerFeature();

  // 响应体更改规则功能
  setTimeout(() => {
    initResponseRulesFeature();
  }, 100);
  initUpdateFeature();
});

// 响应体更改规则功能初始化
function initResponseRulesFeature() {
  console.log('初始化响应体更改规则功能...');
  
  // 检查 electronAPI 是否可用
  if (!window.electronAPI) {
    console.error('window.electronAPI 未定义');
    return;
  }
  
  if (!window.electronAPI.getResponseRules) {
    console.error('window.electronAPI.getResponseRules 未定义');
    return;
  }
  
  console.log('electronAPI 检查通过');
  
  const responseRulesBtn = document.getElementById('responseRulesBtn');
  const responseRulesModal = document.getElementById('response-rules-modal');
  const closeResponseRules = document.getElementById('close-response-rules');
  const ruleEditModal = document.getElementById('rule-edit-modal');
  const closeRuleEdit = document.getElementById('close-rule-edit');

  if (!responseRulesBtn) {
    console.error('未找到 responseRulesBtn 元素');
    return;
  }
  
  if (!responseRulesModal) {
    console.error('未找到 response-rules-modal 元素');
    return;
  }

  // 打开规则管理弹窗
  responseRulesBtn.addEventListener('click', () => {
    console.log('响应规则按钮被点击');
    responseRulesModal.style.display = 'flex';
    loadResponseRules();
  });

  // 关闭规则管理弹窗
  closeResponseRules.addEventListener('click', () => {
    responseRulesModal.style.display = 'none';
  });

  // 关闭规则编辑弹窗
  closeRuleEdit.addEventListener('click', () => {
    ruleEditModal.style.display = 'none';
  });

  // 点击弹窗外部关闭
  window.addEventListener('click', (event) => {
    if (event.target === responseRulesModal) {
      responseRulesModal.style.display = 'none';
    }
    if (event.target === ruleEditModal) {
      ruleEditModal.style.display = 'none';
    }
  });

  // 新建规则
  document.getElementById('add-rule-btn').addEventListener('click', () => {
    openRuleEditor();
  });

  // 导入规则
  document.getElementById('import-rules-btn').addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.importResponseRules();
      if (result.success) {
        showToast(`成功导入 ${result.count} 条规则`, 'success');
        loadResponseRules();
      } else {
        showToast(`导入失败: ${result.error}`, 'error');
      }
    } catch (error) {
      showToast(`导入失败: ${error.message}`, 'error');
    }
  });

  // 导出规则
  document.getElementById('export-rules-btn').addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.exportResponseRules();
      if (result.success) {
        showToast(`规则已导出到: ${result.path}`, 'success');
      } else {
        showToast(`导出失败: ${result.error}`, 'error');
      }
    } catch (error) {
      showToast(`导出失败: ${error.message}`, 'error');
    }
  });

  // 调用规则编辑表单初始化
  initRuleEditForm();
}

// 规则编辑表单初始化
function initRuleEditForm() {
  console.log('初始化规则编辑表单事件监听器...');
  
  // 规则类型变化事件
  const ruleTypeSelect = document.getElementById('rule-type');
  if (ruleTypeSelect) {
    ruleTypeSelect.addEventListener('change', (e) => {
      console.log('规则类型变化:', e.target.value);
      handleRuleTypeChange(e.target.value);
    });
  } else {
    console.error('未找到 rule-type 元素');
  }

  // 操作类型变化事件
  const ruleActionSelect = document.getElementById('rule-action');
  if (ruleActionSelect) {
    ruleActionSelect.addEventListener('change', (e) => {
      console.log('操作类型变化:', e.target.value);
      const ruleType = document.getElementById('rule-type').value;
      handleActionChange(e.target.value, ruleType);
    });
  } else {
    console.error('未找到 rule-action 元素');
  }

  // 注入位置变化事件
  const injectPositionSelect = document.getElementById('rule-inject-position');
  if (injectPositionSelect) {
    injectPositionSelect.addEventListener('change', (e) => {
      handleInjectPositionChange(e.target.value);
    });
  }

  // 添加修改规则按钮
  const addModifyRuleBtn = document.getElementById('add-modify-rule');
  if (addModifyRuleBtn) {
    addModifyRuleBtn.addEventListener('click', addModifyRule);
  }

  // 添加请求头按钮
  const addRequestHeaderBtn = document.getElementById('add-request-header');
  if (addRequestHeaderBtn) {
    addRequestHeaderBtn.addEventListener('click', addRequestHeader);
  }

  // 添加响应头按钮
  const addResponseHeaderBtn = document.getElementById('add-response-header');
  if (addResponseHeaderBtn) {
    addResponseHeaderBtn.addEventListener('click', addResponseHeader);
  }

  // 保存规则按钮
  const saveRuleBtn = document.getElementById('save-rule-btn');
  if (saveRuleBtn) {
    saveRuleBtn.addEventListener('click', () => {
      console.log('保存规则按钮被点击');
      saveRule();
    });
    console.log('保存规则按钮事件监听器已绑定');
  } else {
    console.error('未找到 save-rule-btn 元素');
  }

  // 测试规则按钮
  const testRuleBtn = document.getElementById('test-rule-btn');
  if (testRuleBtn) {
    testRuleBtn.addEventListener('click', () => {
      console.log('测试规则按钮被点击');
      testRule();
    });
    console.log('测试规则按钮事件监听器已绑定');
  } else {
    console.error('未找到 test-rule-btn 元素');
  }

  // 取消按钮
  const cancelRuleBtn = document.getElementById('cancel-rule-btn');
  if (cancelRuleBtn) {
    cancelRuleBtn.addEventListener('click', () => {
      console.log('取消按钮被点击');
      document.getElementById('rule-edit-modal').style.display = 'none';
    });
    console.log('取消按钮事件监听器已绑定');
  } else {
    console.error('未找到 cancel-rule-btn 元素');
  }

  // 替换类型切换
  const replaceTypeRadios = document.querySelectorAll('input[name="replace-type"]');
  replaceTypeRadios.forEach(radio => {
    radio.addEventListener('change', handleReplaceTypeChange);
  });

  // 浏览文件按钮
  const browseFileBtn = document.getElementById('browse-replace-file');
  if (browseFileBtn) {
    browseFileBtn.addEventListener('click', () => {
      window.electronAPI.openFileChoosing();
    });
  }

  // 监听文件选择结果
  window.electronAPI.chooseFile((event, filePath) => {
    if (filePath) {
      document.getElementById('rule-file-path').value = filePath;
    }
  });
}

// 加载响应体更改规则
async function loadResponseRules() {
  console.log('开始加载响应体更改规则...');
  try {
    console.log('调用 window.electronAPI.getResponseRules()...');
    const rules = await window.electronAPI.getResponseRules();
    console.log('获取到的规则:', rules);
    
    if (!Array.isArray(rules)) {
      console.error('规则数据不是数组:', typeof rules, rules);
      showToast('规则数据格式错误', 'error');
      return;
    }
    
    displayResponseRules(rules);
    updateRulesStatus(rules);
    console.log('规则加载完成');
  } catch (error) {
    console.error('加载规则失败:', error);
    console.error('错误详情:', error.message, error.stack);
    showToast(`加载规则失败: ${error.message}`, 'error');
  }
}

// 更新规则状态显示
function updateRulesStatus(rules) {
  const totalCount = rules.length;
  const enabledCount = rules.filter(rule => rule.enabled).length;

  const rulesCountElement = document.getElementById('rules-count');
  const activeRulesCountElement = document.getElementById('active-rules-count');
  
  if (rulesCountElement) {
    rulesCountElement.textContent = `规则数量: ${totalCount}`;
  }
  
  if (activeRulesCountElement) {
    activeRulesCountElement.textContent = `启用: ${enabledCount}`;
  }
}

// 显示规则列表
function displayResponseRules(rules) {
  const rulesList = document.getElementById('rules-list');

  if (rules.length === 0) {
    rulesList.innerHTML = '<div class="no-rules">暂无规则，点击"新建规则"开始添加</div>';
    return;
  }

  rulesList.innerHTML = rules.map(rule => `
        <div class="rule-item" data-rule-id="${rule.id}">
            <input type="checkbox" class="rule-checkbox" ${rule.enabled ? 'checked' : ''} 
                   onchange="toggleRule('${rule.id}', this.checked)">
            <div class="rule-info">
                <div class="rule-name">${escapeHtml(rule.name)}</div>
                <div class="rule-details">
                    <div class="rule-detail-item">
                        <span>类型:</span>
                        <span>${getRuleTypeText(rule.type || 'response')}</span>
                    </div>
                    <div class="rule-detail-item">
                        <span>URL:</span>
                        <span>${rule.urlPattern || '所有'}</span>
                    </div>
                    <div class="rule-detail-item">
                        <span>方法:</span>
                        <span>${rule.method || '所有'}</span>
                    </div>
                    <div class="rule-detail-item">
                        <span>操作:</span>
                        <span>${getActionText(rule.action, rule.type)}</span>
                    </div>
                    <div class="rule-detail-item">
                        <span class="rule-status ${rule.enabled ? 'enabled' : 'disabled'}">
                            ${rule.enabled ? '启用' : '禁用'}
                        </span>
                    </div>
                </div>
            </div>
            <div class="rule-actions">
                <button class="rule-action-btn edit" onclick="editRule('${rule.id}')">编辑</button>
                <button class="rule-action-btn delete" onclick="deleteRule('${rule.id}')">删除</button>
            </div>
        </div>
    `).join('');
}

// 获取规则类型文本
function getRuleTypeText(type) {
  const typeMap = {
    'response': '响应体修改',
    'request': '请求修改',
    'response-headers': '响应头修改'
  };
  return typeMap[type] || type;
}

// 获取操作类型文本
function getActionText(action, ruleType = 'response') {
  const actionMaps = {
    'response': {
      'replace': '替换响应体',
      'modify': '修改响应体',
      'inject': '注入内容'
    },
    'request': {
      'modify-headers': '修改请求头',
      'modify-url': '重定向URL',
      'block': '阻止请求'
    },
    'response-headers': {
      'add-headers': '添加响应头',
      'modify-headers': '修改响应头',
      'remove-headers': '删除响应头'
    }
  };

  const actionMap = actionMaps[ruleType] || actionMaps['response'];
  return actionMap[action] || action;
}

// 切换规则启用状态
async function toggleRule(ruleId, enabled) {
  try {
    const success = await window.electronAPI.toggleResponseRule(ruleId, enabled);
    if (success) {
      loadResponseRules();
    } else {
      showToast('切换规则状态失败', 'error');
    }
  } catch (error) {
    console.error('切换规则状态失败:', error);
    showToast('切换规则状态失败', 'error');
  }
}

// 编辑规则
async function editRule(ruleId) {
  try {
    const rules = await window.electronAPI.getResponseRules();
    const rule = rules.find(r => r.id === ruleId);
    if (rule) {
      openRuleEditor(rule);
    }
  } catch (error) {
    console.error('加载规则失败:', error);
    showToast('加载规则失败', 'error');
  }
}

// 删除规则
async function deleteRule(ruleId) {
  if (confirm('确定要删除这条规则吗？')) {
    try {
      const success = await window.electronAPI.deleteResponseRule(ruleId);
      if (success) {
        loadResponseRules();
        showToast('规则已删除', 'success');
      } else {
        showToast('删除规则失败', 'error');
      }
    } catch (error) {
      console.error('删除规则失败:', error);
      showToast('删除规则失败', 'error');
    }
  }
}

// 打开规则编辑器
async function openRuleEditor(rule = null) {
  const modal = document.getElementById('rule-edit-modal');
  const title = document.getElementById('rule-edit-title');

  if (rule) {
    title.textContent = '编辑规则';
    await fillRuleForm(rule);
  } else {
    title.textContent = '新建规则';
    await clearRuleForm();
  }

  modal.style.display = 'flex';
}

// 填充规则表单
async function fillRuleForm(rule) {
  document.getElementById('rule-name').value = rule.name || '';
  document.getElementById('rule-type').value = rule.type || 'response';
  document.getElementById('rule-url-pattern').value = rule.urlPattern || '';
  document.getElementById('rule-method').value = rule.method || '';
  document.getElementById('rule-enabled').checked = rule.enabled !== false;

  // 处理规则类型变化
  await handleRuleTypeChange(rule.type || 'response');

  // 内容类型只对响应体规则有效
  if (rule.type === 'response') {
    document.getElementById('rule-content-type').value = rule.contentType || '';
  }

  // 设置操作类型
  document.getElementById('rule-action').value = rule.action || 'replace';

  // 根据规则类型和操作类型显示相应的内容区域
  handleActionChange(rule.action, rule.type || 'response');

  // 填充具体内容
  if (rule.type === 'response') {
    switch (rule.action) {
      case 'replace':
        if (rule.replaceWithFile && rule.filePath) {
          // 文件替换
          document.querySelector('input[name="replace-type"][value="file"]').checked = true;
          document.getElementById('rule-file-path').value = rule.filePath || '';
          document.getElementById('file-replace-group').style.display = 'block';
          document.getElementById('rule-replace-content').style.display = 'none';
        } else {
          // 文本替换
          document.querySelector('input[name="replace-type"][value="text"]').checked = true;
          document.getElementById('rule-replace-content').value = rule.replaceContent || '';
          document.getElementById('file-replace-group').style.display = 'none';
          document.getElementById('rule-replace-content').style.display = 'block';
        }
        break;
      case 'modify':
        fillModifyRules(rule.modifyRules || []);
        break;
      case 'inject':
        document.getElementById('rule-inject-content').value = rule.injectContent || '';
        document.getElementById('rule-inject-position').value = rule.injectPosition || 'start';
        document.getElementById('rule-inject-target').value = rule.injectTarget || '';
        handleInjectPositionChange(rule.injectPosition);
        break;
    }
  } else if (rule.type === 'request') {
    switch (rule.action) {
      case 'modify-headers':
        fillRequestHeaders(rule.requestHeaders || {});
        break;
      case 'modify-url':
        document.getElementById('rule-new-url').value = rule.newUrl || '';
        break;
    }
  } else if (rule.type === 'response-headers') {
    switch (rule.action) {
      case 'add-headers':
      case 'modify-headers':
        fillResponseHeaders(rule.responseHeaders || {});
        break;
      case 'remove-headers':
        document.getElementById('rule-remove-headers').value = (rule.removeHeaders || []).join(', ');
        break;
    }
  }

  // 存储规则ID用于更新
  document.getElementById('rule-edit-modal').dataset.ruleId = rule.id || '';
}

// 清空规则表单
async function clearRuleForm() {
  document.getElementById('rule-name').value = '';
  document.getElementById('rule-type').value = 'response';
  document.getElementById('rule-url-pattern').value = '';
  document.getElementById('rule-method').value = '';
  document.getElementById('rule-content-type').value = '';
  document.getElementById('rule-enabled').checked = true;
  document.getElementById('rule-replace-content').value = '';
  document.getElementById('rule-file-path').value = '';
  document.getElementById('rule-inject-content').value = '';
  document.getElementById('rule-inject-position').value = 'start';
  document.getElementById('rule-inject-target').value = '';
  document.getElementById('rule-new-url').value = '';
  document.getElementById('rule-remove-headers').value = '';

  // 重置替换类型为文本
  document.querySelector('input[name="replace-type"][value="text"]').checked = true;
  document.getElementById('file-replace-group').style.display = 'none';

  // 清空修改规则
  const modifyContainer = document.querySelector('.modify-rules-container');
  if (modifyContainer) {
    modifyContainer.innerHTML = '<div class="modify-rule-item"><input type="text" placeholder="查找内容(支持正则)" class="find-input"><input type="text" placeholder="替换为" class="replace-input"><button type="button" class="remove-modify-rule" onclick="removeModifyRule(this)">删除</button></div>';
  }

  // 清空请求头
  const requestHeadersContainer = document.querySelector('#request-headers-group .headers-container');
  if (requestHeadersContainer) {
    requestHeadersContainer.innerHTML = '<div class="header-item"><input type="text" placeholder="请求头名称" class="header-name-input"><input type="text" placeholder="请求头值" class="header-value-input"><button type="button" class="remove-header" onclick="removeHeader(this)">删除</button></div>';
  }

  // 清空响应头
  const responseHeadersContainer = document.querySelector('#response-headers-group .headers-container');
  if (responseHeadersContainer) {
    responseHeadersContainer.innerHTML = '<div class="header-item"><input type="text" placeholder="响应头名称" class="header-name-input"><input type="text" placeholder="响应头值" class="header-value-input"><button type="button" class="remove-header" onclick="removeHeader(this)">删除</button></div>';
  }

  // 处理默认规则类型
  await handleRuleTypeChange('response');

  document.getElementById('rule-edit-modal').dataset.ruleId = '';
}

// 填充修改规则
function fillModifyRules(modifyRules) {
  const container = document.querySelector('.modify-rules-container');
  container.innerHTML = '';

  if (modifyRules.length === 0) {
    addModifyRule();
  } else {
    modifyRules.forEach(rule => {
      const div = document.createElement('div');
      div.className = 'modify-rule-item';
      div.innerHTML = `
        <input type="text" placeholder="查找内容(支持正则)" class="find-input" value="${escapeHtml(rule.find || '')}">
        <input type="text" placeholder="替换为" class="replace-input" value="${escapeHtml(rule.replace || '')}">
        <button type="button" class="remove-modify-rule" onclick="removeModifyRule(this)">删除</button>
      `;
      container.appendChild(div);
    });
  }
}

// 填充请求头
function fillRequestHeaders(headers) {
  const container = document.querySelector('#request-headers-group .headers-container');
  container.innerHTML = '';

  const headerEntries = Object.entries(headers);
  if (headerEntries.length === 0) {
    addRequestHeader();
  } else {
    headerEntries.forEach(([name, value]) => {
      const div = document.createElement('div');
      div.className = 'header-item';
      div.innerHTML = `
        <input type="text" placeholder="请求头名称" class="header-name-input" value="${escapeHtml(name)}">
        <input type="text" placeholder="请求头值" class="header-value-input" value="${escapeHtml(value)}">
        <button type="button" class="remove-header" onclick="removeHeader(this)">删除</button>
      `;
      container.appendChild(div);
    });
  }
}

// 填充响应头
function fillResponseHeaders(headers) {
  const container = document.querySelector('#response-headers-group .headers-container');
  container.innerHTML = '';

  const headerEntries = Object.entries(headers);
  if (headerEntries.length === 0) {
    addResponseHeader();
  } else {
    headerEntries.forEach(([name, value]) => {
      const div = document.createElement('div');
      div.className = 'header-item';
      div.innerHTML = `
        <input type="text" placeholder="响应头名称" class="header-name-input" value="${escapeHtml(name)}">
        <input type="text" placeholder="响应头值" class="header-value-input" value="${escapeHtml(value)}">
        <button type="button" class="remove-header" onclick="removeHeader(this)">删除</button>
      `;
      container.appendChild(div);
    });
  }
}

// 处理规则类型变化
async function handleRuleTypeChange(ruleType) {
  const contentTypeGroup = document.getElementById('content-type-group');
  const actionSelect = document.getElementById('rule-action');

  // 内容类型字段只对响应体规则有效
  if (ruleType === 'response') {
    contentTypeGroup.style.display = 'block';
  } else {
    contentTypeGroup.style.display = 'none';
  }

  // 根据规则类型更新操作选项
  try {
    const actionTypes = await window.electronAPI.getActionTypes(ruleType);
    actionSelect.innerHTML = '';

    actionTypes.forEach(actionType => {
      const option = document.createElement('option');
      option.value = actionType.value;
      option.textContent = actionType.label;
      option.title = actionType.description;
      actionSelect.appendChild(option);
    });

    // 触发操作类型变化处理
    if (actionTypes.length > 0) {
      handleActionChange(actionTypes[0].value, ruleType);
    }
  } catch (error) {
    console.error('获取操作类型失败:', error);
  }
}

// 添加请求头
function addRequestHeader() {
  const container = document.querySelector('#request-headers-group .headers-container');
  const div = document.createElement('div');
  div.className = 'header-item';
  div.innerHTML = `
    <input type="text" placeholder="请求头名称" class="header-name-input">
    <input type="text" placeholder="请求头值" class="header-value-input">
    <button type="button" class="remove-header" onclick="removeHeader(this)">删除</button>
  `;
  container.appendChild(div);
}

// 添加响应头
function addResponseHeader() {
  const container = document.querySelector('#response-headers-group .headers-container');
  const div = document.createElement('div');
  div.className = 'header-item';
  div.innerHTML = `
    <input type="text" placeholder="响应头名称" class="header-name-input">
    <input type="text" placeholder="响应头值" class="header-value-input">
    <button type="button" class="remove-header" onclick="removeHeader(this)">删除</button>
  `;
  container.appendChild(div);
}

// 删除头部
function removeHeader(button) {
  const container = button.closest('.headers-container');
  if (container.children.length > 1) {
    button.parentElement.remove();
  } else {
    showToast('至少需要保留一个头部项', 'error');
  }
}

// 处理操作类型变化
function handleActionChange(action, ruleType) {
  const replaceGroup = document.getElementById('replace-content-group');
  const modifyGroup = document.getElementById('modify-rules-group');
  const injectGroup = document.getElementById('inject-content-group');
  const requestHeadersGroup = document.getElementById('request-headers-group');
  const newUrlGroup = document.getElementById('new-url-group');
  const responseHeadersGroup = document.getElementById('response-headers-group');
  const removeHeadersGroup = document.getElementById('remove-headers-group');

  // 隐藏所有组
  replaceGroup.style.display = 'none';
  modifyGroup.style.display = 'none';
  injectGroup.style.display = 'none';
  requestHeadersGroup.style.display = 'none';
  newUrlGroup.style.display = 'none';
  responseHeadersGroup.style.display = 'none';
  removeHeadersGroup.style.display = 'none';

  // 根据规则类型和操作类型显示对应的组
  if (ruleType === 'response') {
    switch (action) {
      case 'replace':
        replaceGroup.style.display = 'block';
        break;
      case 'modify':
        modifyGroup.style.display = 'block';
        break;
      case 'inject':
        injectGroup.style.display = 'block';
        break;
    }
  } else if (ruleType === 'request') {
    switch (action) {
      case 'modify-headers':
        requestHeadersGroup.style.display = 'block';
        break;
      case 'modify-url':
        newUrlGroup.style.display = 'block';
        break;
      case 'block':
        // 阻止请求不需要额外字段
        break;
    }
  } else if (ruleType === 'response-headers') {
    switch (action) {
      case 'add-headers':
      case 'modify-headers':
        responseHeadersGroup.style.display = 'block';
        break;
      case 'remove-headers':
        removeHeadersGroup.style.display = 'block';
        break;
    }
  }
}

// 处理注入位置变化
function handleInjectPositionChange(position) {
  const targetInput = document.getElementById('rule-inject-target');
  if (position === 'before' || position === 'after') {
    targetInput.style.display = 'block';
    targetInput.required = true;
  } else {
    targetInput.style.display = 'none';
    targetInput.required = false;
  }
}

// 添加修改规则
function addModifyRule() {
  const container = document.querySelector('.modify-rules-container');
  const div = document.createElement('div');
  div.className = 'modify-rule-item';
  div.innerHTML = `
        <input type="text" placeholder="查找内容(支持正则)" class="find-input">
        <input type="text" placeholder="替换为" class="replace-input">
        <button type="button" class="remove-modify-rule" onclick="removeModifyRule(this)">删除</button>
    `;
  container.appendChild(div);
}

// 删除修改规则
function removeModifyRule(button) {
  const container = document.querySelector('.modify-rules-container');
  if (container.children.length > 1) {
    button.parentElement.remove();
  } else {
    showToast('至少需要保留一条修改规则', 'error');
  }
}

// 保存规则
async function saveRule() {
  console.log('saveRule 函数被调用');
  try {
    const rule = collectRuleData();
    console.log('收集到的规则数据:', rule);
    if (!validateRule(rule)) {
      console.log('规则验证失败');
      return;
    }

    console.log('开始保存规则...');
    const success = await window.electronAPI.saveResponseRule(rule);
    if (success) {
      document.getElementById('rule-edit-modal').style.display = 'none';
      loadResponseRules();
      showToast('规则保存成功', 'success');
      console.log('规则保存成功');
    } else {
      showToast('规则保存失败', 'error');
      console.log('规则保存失败');
    }
  } catch (error) {
    console.error('保存规则失败:', error);
    showToast('保存规则失败', 'error');
  }
}

// 收集规则数据
function collectRuleData() {
  const ruleId = document.getElementById('rule-edit-modal').dataset.ruleId;
  const ruleType = document.getElementById('rule-type').value;
  const rule = {
    name: document.getElementById('rule-name').value.trim(),
    type: ruleType,
    urlPattern: document.getElementById('rule-url-pattern').value.trim(),
    method: document.getElementById('rule-method').value,
    action: document.getElementById('rule-action').value,
    enabled: document.getElementById('rule-enabled').checked
  };

  // 内容类型只对响应体规则有效
  if (ruleType === 'response') {
    rule.contentType = document.getElementById('rule-content-type').value.trim();
  }

  if (ruleId) {
    rule.id = ruleId;
  }

  // 根据规则类型和操作类型收集具体数据
  if (ruleType === 'response') {
    switch (rule.action) {
      case 'replace':
        const replaceType = document.querySelector('input[name="replace-type"]:checked').value;
        if (replaceType === 'file') {
          rule.replaceWithFile = true;
          rule.filePath = document.getElementById('rule-file-path').value;
          rule.replaceContent = ''; // 清空文本内容
        } else {
          rule.replaceWithFile = false;
          rule.filePath = '';
          rule.replaceContent = document.getElementById('rule-replace-content').value;
        }
        break;
      case 'modify':
        rule.modifyRules = [];
        const modifyItems = document.querySelectorAll('.modify-rule-item');
        modifyItems.forEach(item => {
          const find = item.querySelector('.find-input').value.trim();
          const replace = item.querySelector('.replace-input').value;
          if (find) {
            rule.modifyRules.push({ find, replace });
          }
        });
        break;
      case 'inject':
        rule.injectContent = document.getElementById('rule-inject-content').value;
        rule.injectPosition = document.getElementById('rule-inject-position').value;
        rule.injectTarget = document.getElementById('rule-inject-target').value.trim();
        break;
    }
  } else if (ruleType === 'request') {
    switch (rule.action) {
      case 'modify-headers':
        rule.requestHeaders = {};
        const requestHeaderItems = document.querySelectorAll('#request-headers-group .header-item');
        requestHeaderItems.forEach(item => {
          const name = item.querySelector('.header-name-input').value.trim();
          const value = item.querySelector('.header-value-input').value.trim();
          if (name) {
            rule.requestHeaders[name] = value;
          }
        });
        break;
      case 'modify-url':
        rule.newUrl = document.getElementById('rule-new-url').value.trim();
        break;
      case 'block':
        // 阻止请求不需要额外数据
        break;
    }
  } else if (ruleType === 'response-headers') {
    switch (rule.action) {
      case 'add-headers':
      case 'modify-headers':
        rule.responseHeaders = {};
        const responseHeaderItems = document.querySelectorAll('#response-headers-group .header-item');
        responseHeaderItems.forEach(item => {
          const name = item.querySelector('.header-name-input').value.trim();
          const value = item.querySelector('.header-value-input').value.trim();
          if (name) {
            rule.responseHeaders[name] = value;
          }
        });
        break;
      case 'remove-headers':
        const removeHeadersValue = document.getElementById('rule-remove-headers').value.trim();
        rule.removeHeaders = removeHeadersValue ? removeHeadersValue.split(',').map(h => h.trim()) : [];
        break;
    }
  }

  return rule;
}

// 验证规则数据
function validateRule(rule) {
  if (!rule.name) {
    showToast('请输入规则名称', 'error');
    return false;
  }

  // 验证URL模式是否为有效正则表达式
  if (rule.urlPattern) {
    try {
      new RegExp(rule.urlPattern);
    } catch (e) {
      showToast('URL匹配模式不是有效的正则表达式', 'error');
      return false;
    }
  }

  // 根据规则类型和操作类型验证具体内容
  if (rule.type === 'response') {
    switch (rule.action) {
      case 'replace':
        if (rule.replaceWithFile) {
          if (!rule.filePath) {
            showToast('请选择替换文件', 'error');
            return false;
          }
        } else {
          if (!rule.replaceContent && rule.replaceContent !== '') {
            showToast('请输入替换内容', 'error');
            return false;
          }
        }
        break;
      case 'modify':
        if (!rule.modifyRules || rule.modifyRules.length === 0) {
          showToast('请至少添加一条修改规则', 'error');
          return false;
        }
        // 验证正则表达式
        for (const modifyRule of rule.modifyRules) {
          try {
            new RegExp(modifyRule.find);
          } catch (e) {
            showToast(`修改规则中的查找内容不是有效的正则表达式: ${modifyRule.find}`, 'error');
            return false;
          }
        }
        break;
      case 'inject':
        if (!rule.injectContent) {
          showToast('请输入注入内容', 'error');
          return false;
        }
        if ((rule.injectPosition === 'before' || rule.injectPosition === 'after') && !rule.injectTarget) {
          showToast('请输入目标内容', 'error');
          return false;
        }
        break;
    }
  } else if (rule.type === 'request') {
    switch (rule.action) {
      case 'modify-headers':
        if (!rule.requestHeaders || Object.keys(rule.requestHeaders).length === 0) {
          showToast('请至少添加一个请求头', 'error');
          return false;
        }
        break;
      case 'modify-url':
        if (!rule.newUrl) {
          showToast('请输入重定向URL', 'error');
          return false;
        }
        try {
          new URL(rule.newUrl);
        } catch (e) {
          showToast('重定向URL格式不正确', 'error');
          return false;
        }
        break;
      case 'block':
        // 阻止请求不需要验证额外内容
        break;
    }
  } else if (rule.type === 'response-headers') {
    switch (rule.action) {
      case 'add-headers':
      case 'modify-headers':
        if (!rule.responseHeaders || Object.keys(rule.responseHeaders).length === 0) {
          showToast('请至少添加一个响应头', 'error');
          return false;
        }
        break;
      case 'remove-headers':
        if (!rule.removeHeaders || rule.removeHeaders.length === 0) {
          showToast('请输入要删除的响应头名称', 'error');
          return false;
        }
        break;
    }
  }

  return true;
}

// 测试规则
function testRule() {
  console.log('testRule 函数被调用');
  const rule = collectRuleData();
  console.log('收集到的规则数据:', rule);
  if (!validateRule(rule)) {
    console.log('规则验证失败');
    return;
  }

  // 这里可以实现规则测试逻辑
  console.log('规则验证通过');
  showToast('规则验证通过', 'success');
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 显示提示消息
function showToast(message, type = 'info') {
  // 创建提示元素
  const toast = document.createElement('div');
  toast.className = `copy-toast ${type === 'error' ? 'error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // 显示提示
  setTimeout(() => {
    toast.classList.add('show');
  }, 100);

  // 3秒后隐藏
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 3000);
}

// 将函数暴露到全局作用域，供HTML中的onclick使用
window.toggleRule = toggleRule;
window.editRule = editRule;
window.deleteRule = deleteRule;
window.removeModifyRule = removeModifyRule;
window.removeHeader = removeHeader;

function initUpdateFeature() {
  const updateModal = document.getElementById('update-modal');
  const updateDownloadedModal = document.getElementById('update-downloaded-modal');
  const closeUpdate = document.getElementById('close-update');
  const updateCancel = document.getElementById('update-cancel');
  const updateConfirmBtn = document.getElementById('update-confirm-btn');
  const updateInstallLater = document.getElementById('update-install-later');
  const updateInstallNow = document.getElementById('update-install-now');

  if (closeUpdate) {
    closeUpdate.addEventListener('click', () => {
      updateModal.style.display = 'none';
    });
  }

  if (updateCancel) {
    updateCancel.addEventListener('click', () => {
      updateModal.style.display = 'none';
    });
  }

  if (updateConfirmBtn) {
    updateConfirmBtn.addEventListener('click', () => {
      window.electronAPI.updateConfirm();
      const progressContainer = document.getElementById('update-progress-container');
      const confirmBtn = document.getElementById('update-confirm-btn');
      const cancelBtn = document.getElementById('update-cancel');
      if (progressContainer) progressContainer.style.display = 'block';
      if (confirmBtn) confirmBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
    });
  }

  if (updateInstallLater) {
    updateInstallLater.addEventListener('click', () => {
      updateDownloadedModal.style.display = 'none';
    });
  }

  if (updateInstallNow) {
    updateInstallNow.addEventListener('click', () => {
      window.electronAPI.updateInstall();
    });
  }

  const updateNotificationBtn = document.getElementById('update-notification-btn');
  if (updateNotificationBtn) {
    updateNotificationBtn.addEventListener('click', () => {
      updateModal.style.display = 'flex';
    });
  }

  window.electronAPI.onUpdateAvailable((data) => {
    document.getElementById('update-version').textContent = data.version;
    const releaseDate = data.releaseDate ? new Date(data.releaseDate).toLocaleDateString('zh-CN') : '未知';
    document.getElementById('update-date').textContent = releaseDate;

    let releaseNotes = data.releaseNotes || '新版本已发布，请更新以获得最新功能。';
    if (typeof releaseNotes !== 'string') {
      if (Array.isArray(releaseNotes)) {
        releaseNotes = releaseNotes.join('\n');
      } else {
        releaseNotes = '新版本已发布，请更新以获得最新功能。';
      }
    }

    const notesElement = document.getElementById('update-notes');
    notesElement.innerHTML = releaseNotes.trim();

    const progressContainer = document.getElementById('update-progress-container');
    if (progressContainer) progressContainer.style.display = 'none';
    const confirmBtn = document.getElementById('update-confirm-btn');
    const cancelBtn = document.getElementById('update-cancel');
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;

    if (updateNotificationBtn) {
      updateNotificationBtn.style.display = 'flex';
    }

    updateModal.style.display = 'flex';
  });

  window.electronAPI.onUpdateNotAvailable((data) => {
    if (data && data.isDev) {
      return;
    }
    showToast('已是最新版本', 'info');
  });

  window.electronAPI.onUpdateDownloadProgress((data) => {
    const progressText = document.getElementById('update-progress-text');
    const progressSpeed = document.getElementById('update-progress-speed');
    const progressBarFill = document.getElementById('update-progress-bar-fill');

    if (progressText) {
      const percent = Math.round(data.percent || 0);
      progressText.textContent = `下载中: ${percent}%`;
    }

    if (progressSpeed) {
      if (data.bytesPerSecond) {
        const speed = formatBytes(data.bytesPerSecond);
        progressSpeed.textContent = speed + '/s';
      } else {
        progressSpeed.textContent = '';
      }
    }

    if (progressBarFill) {
      progressBarFill.style.width = `${data.percent || 0}%`;
    }
  });

  window.electronAPI.onUpdateDownloaded(() => {
    updateModal.style.display = 'none';
    updateDownloadedModal.style.display = 'flex';
  });

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}// 处理替换类型
切换
function handleReplaceTypeChange() {
  const replaceType = document.querySelector('input[name="replace-type"]:checked').value;
  const textArea = document.getElementById('rule-replace-content');
  const fileGroup = document.getElementById('file-replace-group');
  
  if (replaceType === 'file') {
    textArea.style.display = 'none';
    fileGroup.style.display = 'block';
  } else {
    textArea.style.display = 'block';
    fileGroup.style.display = 'none';
  }
}