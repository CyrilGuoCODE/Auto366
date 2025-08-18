class SystemAudioSync {
  constructor() {
    this.audioContext = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (!this.isInitialized) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.isInitialized = true;
    }
  }

  async syncWithSystemAudio(filePath) {
    await this.initialize();

    try {
      console.log(`系统音频同步: ${filePath}`);

      if (window.electronAPI && window.electronAPI.writeSystemAudio) {
        window.electronAPI.writeSystemAudio(filePath);
      }

      return true;
    } catch (error) {
      console.error('系统音频同步失败:', error);
      return false;
    }
  }
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
  
  initSettingsBtn(){
	document.getElementById('settingsBtn').addEventListener('click', () => {
	  document.getElementById('settingsDiv').style.display = 'block'
	  document.getElementById('pathIpt').value = window.electronAPI.getResourcePath()
	})
	document.getElementById('closeBtn').addEventListener('click', () => {
	  document.getElementById('settingsDiv').style.display = 'none'
	})
	document.getElementById('showBtn').addEventListener('click', function() {
	  window.electronAPI.openDirectoryChoosing()
	})
	window.electronAPI.chooseDirectory((event, path) => {
	  document.getElementById('pathIpt').value = path
	})
	document.getElementById('cancelBtn').addEventListener('click', function() {
	  document.getElementById('settingsDiv').style.display = 'none'
	})
	document.getElementById('setBtn').addEventListener('click', function() {
	  window.electronAPI.setResourcePath(document.getElementById('pathIpt').value)
	  document.getElementById('settingsDiv').style.display = 'none'
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
  
  initLocations(){
	let locations = localStorage.getItem('pos-listening')
	if (locations){
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

    if (confirm('警告：此操作将删除 D:/Up366StudentFiles/resources/ 目录下的所有文件！\n\n确定要继续吗？')) {
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
      resultDiv.innerHTML = '<span class="error">资源路径不存在: D:/Up366StudentFiles/resources/</span>';
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
    this.pkStep = 1;
    this.initEventListeners();
    this.updatePkStepGuide(this.pkStep);
  }

  initEventListeners() {
    document.getElementById('locationBtn-pk').addEventListener('click', () => {
      window.electronAPI.openLocationWindowPk();
      this.pkStep = 2;
      setTimeout(() => this.updatePkStepGuide(this.pkStep), 300);
    });

    document.getElementById('startBtn-pk').addEventListener('click', () => {
      const resultDiv = document.getElementById('result');
      resultDiv.innerHTML = `
        <strong>正在执行自动选择...</strong><br>
        请稍候，不要移动鼠标或切换窗口
        <span id="pk-step-guide"></span>
      `;
      this.pkStep = 3;
      setTimeout(() => this.updatePkStepGuide(this.pkStep), 300);
      window.electronAPI.startChoose();
    });
  }

  updatePkStepGuide(step) {
    const guide = document.getElementById('pk-step-guide');
    if (!guide) return;
    if (step === 1) {
      guide.innerHTML = '<strong>第一步：</strong>请确保屏幕缩放为100%，否则自动选择可能会出现偏差(很重要)';
    } else if (step === 2) {
      guide.innerHTML = '<strong>第二步：</strong>点击"设置截图位置"按钮，按提示完成截图区域设置，然后点击"开始自动选择"按钮';
    } else if (step === 3) {
      guide.innerHTML = '<strong>第三步：</strong>程序正在自动选择，请勿操作鼠标和键盘，等待完成提示';
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
      this.handleDeleteFlipbooks();
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

  handleDeleteFlipbooks() {
    const resultDiv = document.getElementById('answerResult');

    if (confirm('警告：此操作将删除 D:/Up366StudentFiles/flipbooks/ 目录下的所有文件！\n\n确定要继续吗？')) {
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

    if (confirm(`警告：此操作将替换 D:/Up366StudentFiles/flipbooks/${folderPath}/bookres/media/ 目录下的所有MP3文件！\n\n确定要继续吗？`)) {
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

    if (confirm(`确定要还原 D:/Up366StudentFiles/flipbooks/${folderPath}/bookres/media/ 目录下的音频文件吗？`)) {
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
    this.initEventListeners();
    this.initIpcListeners();
  }

  initEventListeners() {
    document.getElementById('startProxyBtn').addEventListener('click', () => {
      this.startProxy();
    });

    document.getElementById('stopProxyBtn').addEventListener('click', () => {
      this.stopProxy();
    });

    document.getElementById('startCaptureBtn').addEventListener('click', () => {
      this.startCapture();
    });

    document.getElementById('stopCaptureBtn').addEventListener('click', () => {
      this.stopCapture();
    });
  }

  initIpcListeners() {
    // 监听代理状态
    window.electronAPI.onProxyStatus((event, data) => {
      this.updateProxyStatus(data);
    });

    // 监听流量日志
    window.electronAPI.onTrafficLog((event, data) => {
      this.addTrafficLog(data);
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
    window.electronAPI.startAnswerProxy();
    this.addInfoLog('正在启动代理服务器...');
  }

  stopProxy() {
    window.electronAPI.stopAnswerProxy();
    this.addInfoLog('正在停止代理服务器...');
  }

  startCapture() {
    window.electronAPI.startCapturing();
    this.addInfoLog('开始监听网络请求...');
  }

  stopCapture() {
    window.electronAPI.stopCapturing();
    this.addInfoLog('停止监听网络请求');
  }

  updateProxyStatus(data) {
    const statusElement = document.getElementById('proxyStatus');
    const startBtn = document.getElementById('startProxyBtn');
    const stopBtn = document.getElementById('stopProxyBtn');
    const captureBtn = document.getElementById('startCaptureBtn');

    if (data.running) {
      this.isProxyRunning = true;
      statusElement.textContent = '运行中';
      statusElement.className = 'status-value running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      captureBtn.disabled = false;
      this.addSuccessLog(data.message);
    } else {
      this.isProxyRunning = false;
      statusElement.textContent = '已停止';
      statusElement.className = 'status-value stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      captureBtn.disabled = true;
      document.getElementById('stopCaptureBtn').disabled = true;
      this.addInfoLog(data.message);
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
    } else {
      this.isCapturing = false;
      statusElement.textContent = '未开始';
      statusElement.className = 'status-value stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
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
    const logText = `[${timestamp}] ${data.method} ${data.url}`;
    this.addLogItem(logText, 'normal');
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

    // 更新处理状态
    processStatus.textContent = '完成';
    processStatus.className = 'status-value running';

    // 清空容器
    container.innerHTML = '';

    if (data.answers.length === 0) {
      container.innerHTML = '<div class="no-answers">未找到答案数据</div>';
      return;
    }

    // 按来源文件分组显示答案
    const answersByFile = {};
    data.answers.forEach(answer => {
      const sourceFile = answer.sourceFile || '未知文件';
      if (!answersByFile[sourceFile]) {
        answersByFile[sourceFile] = [];
      }
      answersByFile[sourceFile].push(answer);
    });

    // 显示每个文件的答案
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

      answersByFile[sourceFile].forEach((answer, index) => {
        const answerItem = document.createElement('div');
        answerItem.className = 'answer-item';
        answerItem.innerHTML = `
          <div class="answer-number">第 ${answer.question || index + 1} 题</div>
          <div class="answer-option">${answer.answer}</div>
          <div class="answer-content">${answer.content || '暂无内容'}</div>
          ${answer.pattern ? `<div class="answer-pattern">提取模式: ${answer.pattern}</div>` : ''}
        `;
        fileSection.appendChild(answerItem);
      });

      container.appendChild(fileSection);
    });

    this.addSuccessLog(`答案提取完成！共 ${data.count} 题，来自 ${Object.keys(answersByFile).length} 个文件，已保存到: ${data.file}`);
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
});