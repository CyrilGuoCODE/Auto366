class FileUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
  }

  // 初始化文件管理UI
  initFileUI() {
    // 替换音频按钮事件绑定
    const replaceAudioBtn = document.getElementById('replaceAudioBtn');
    if (replaceAudioBtn) {
      replaceAudioBtn.addEventListener('click', () => {
        this.replaceAudio();
      });
    }
  }

  // 替换音频文件
  async replaceAudio() {
    try {
      this.logManager.addInfoLog('正在替换音频文件...');
      const result = await window.electronAPI.replaceAudio();

      if (result && result.success) {
        this.logManager.addSuccessLog(result.message);
      } else if (result && !result.success) {
        this.logManager.addErrorLog(`音频替换失败: ${result.error || '未知错误'}`);
      } else {
        this.logManager.addErrorLog('音频替换失败');
      }
    } catch (error) {
      this.logManager.addErrorLog(`音频替换失败: ${error.message}`);
    }
  }
}

export default FileUI;
