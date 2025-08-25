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
    })
    document.getElementsByClassName('close')[0].addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none'
    })
    document.getElementById('browse-cache').addEventListener('click', function () {
      window.electronAPI.openDirectoryChoosing()
    })
    window.electronAPI.chooseDirectory((event, path) => {
      document.getElementById('cache-path').value = path
    })
    document.getElementById('save-settings').addEventListener('click', function () {
      if (window.electronAPI.setCachePath(document.getElementById('cache-path').value)) {
        localStorage.setItem('cache-path', document.getElementById('cache-path').value)
		cachePath = document.getElementById('cache-path').value
        document.getElementById('settings-modal').style.display = 'none'
      }
      else {
        document.getElementById('error-message').textContent = '路径不正确，请设置正确的路径'
      }
    })
    document.getElementById('reset-settings').addEventListener('click', function () {
      document.getElementById('cache-path').value = 'D:\\Up366StudentFiles'
	  cachePath = 'D:\\Up366StudentFiles'
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
    if (res == 1){
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

    // 更新处理状态
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
      '朗读短文': 4
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

        sortedAnswers.forEach((answer, index) => {
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

          sortedAnswers.forEach((answer, index) => {
            const answerItem = document.createElement('div');
            answerItem.className = 'answer-item';
            answerItem.innerHTML = `
              <div class="answer-number">${answer.sourceFile ? `[${answer.sourceFile}]` : ''} 第 ${answer.question || index + 1} 题</div>
              <div class="answer-option">${answer.answer}</div>
              <div class="answer-content">${answer.content || '暂无内容'}</div>
              ${answer.sourceFile ? `<div class="answer-source">来源: ${answer.sourceFile}</div>` : ''}
            `;
            patternSection.appendChild(answerItem);
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