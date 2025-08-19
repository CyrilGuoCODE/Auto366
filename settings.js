document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('settings-modal');
    const closeBtn = document.querySelector('.close');
    const settingsBtns = document.querySelectorAll('.settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings');
    const resetSettingsBtn = document.getElementById('reset-settings');
    const cachePathInput = document.getElementById('cache-path');
    const browseCacheBtn = document.getElementById('browse-cache');

    const defaultCachePath = 'D:/Up366StudentFiles';

    function loadSettings() {
        const savedPath = localStorage.getItem('cachePath');
        if (savedPath) {
            cachePathInput.value = savedPath;
        } else {
            cachePathInput.value = defaultCachePath;
        }
    }

    function saveSettings() {
        const path = cachePathInput.value.trim();
        if (!path) {
            alert('请输入有效的缓存文件夹路径');
            return;
        }

        localStorage.setItem('cachePath', path);

        if (window.electronAPI && window.electronAPI.updateCachePath) {
            window.electronAPI.updateCachePath(path).then(result => {
                if (result.error) {
                    alert('保存设置失败: ' + result.error);
                }
            }).catch(err => {
                alert('保存设置失败: ' + err.message);
            });
        }

        const saveBtn = document.getElementById('save-settings');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '已保存';
        saveBtn.style.backgroundColor = '#28a745';

        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.style.backgroundColor = '';
        }, 2000);
    }

    function resetSettings() {
        if (confirm('确定要重置为默认设置吗？')) {
            localStorage.removeItem('cachePath');
            cachePathInput.value = defaultCachePath;

            if (window.electronAPI && window.electronAPI.updateCachePath) {
                window.electronAPI.updateCachePath(defaultCachePath).then(result => {
                    if (result.error) {
                        alert('重置设置失败: ' + result.error);
                    }
                }).catch(err => {
                    alert('重置设置失败: ' + err.message);
                });
            }

            const resetBtn = document.getElementById('reset-settings');
            const originalText = resetBtn.textContent;
            resetBtn.textContent = '已重置';
            resetBtn.style.backgroundColor = '#28a745';

            setTimeout(() => {
                resetBtn.textContent = originalText;
                resetBtn.style.backgroundColor = '';
            }, 2000);
        }
    }

    function openSettings() {
        modal.style.display = 'block';
        loadSettings();
    }

    function closeSettings() {
        modal.style.display = 'none';
    }

    settingsBtns.forEach(btn => {
        btn.addEventListener('click', openSettings);
    });

    closeBtn.addEventListener('click', closeSettings);

    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeSettings();
        }
    });

    saveSettingsBtn.addEventListener('click', saveSettings);

    resetSettingsBtn.addEventListener('click', resetSettings);

    browseCacheBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.showOpenDialog) {
            window.electronAPI.showOpenDialog().then(result => {
                if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                    cachePathInput.value = result.filePaths[0];
                }
            }).catch(err => {
                console.error('打开文件选择器失败:', err);
            });
        } else {
            const path = prompt('请输入缓存文件夹路径:', cachePathInput.value);
            if (path) {
                cachePathInput.value = path;
            }
        }
    });
    loadSettings();

    if (window.electronAPI) {
      window.electronAPI.onCachePathUpdated((event, data) => {
        console.log('收到缓存路径更新通知:', data);
        if (data.path) {
          cachePathInput.value = data.path;
        }
      });
    }
});
