const { spawn, execSync } = require('child_process');
const { ipcMain, shell } = require('electron');
const fs = require('fs-extra');

class ProcessMonitor {
  constructor() {
    this.mainWindow = null;
    this.psProcess = null;
    this.isMonitoring = false;
    this.isUp366Running = false;
  }

  _getPsScript() {
    return `
$startQuery = "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName='up366.exe'"
$stopQuery = "SELECT * FROM Win32_ProcessStopTrace WHERE ProcessName='up366.exe'"

try {
  Register-CimIndicationEvent -Query $startQuery -SourceIdentifier "Up366Start" -ErrorAction Stop | Out-Null
  Register-CimIndicationEvent -Query $stopQuery -SourceIdentifier "Up366Stop" -ErrorAction Stop | Out-Null
} catch {
  [Console]::WriteLine('ERROR:WMI-' + $_.Exception.Message)
  exit 1
}

[Console]::WriteLine('READY')

while ($true) {
  $event = Wait-Event -Timeout 1
  if ($event) {
    try {
      $procEvent = $event.SourceEventArgs.NewEvent
      $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
      if ($event.SourceIdentifier -eq 'Up366Start') {
        [Console]::WriteLine(
          'EVENT:START|' + $procEvent.ProcessName + '|' + $procEvent.ProcessID + '|' + $ts
        )
      } elseif ($event.SourceIdentifier -eq 'Up366Stop') {
        [Console]::WriteLine(
          'EVENT:STOP|' + $procEvent.ProcessName + '|' + $procEvent.ProcessID + '|' + $ts
        )
      }
    } catch {
      [Console]::WriteLine('EVENT_ERROR:' + $_.Exception.Message)
    }
    Remove-Event -EventIdentifier $event.EventIdentifier
  }
}
`;
  }

  start(mainWindow) {
    if (this.isMonitoring) return { success: false, message: '进程监控已在运行中' };
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, message: '主窗口不可用' };

    this.mainWindow = mainWindow;
    this.isMonitoring = true;

    const psScript = this._getPsScript();

    this.psProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', psScript
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.psProcess.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        if (line === 'READY') {
          this.safeIpcSend('process-monitor-event', {
            type: 'ready',
            processName: 'up366.exe',
            pid: null,
            timestamp: new Date().toISOString()
          });
          this._queryProcessCount().then(({ count, pids }) => {
            this._updateState(count, pids);
          });
          return;
        }

        if (line.startsWith('ERROR:')) {
          const errMsg = line.substring(6);
          this.safeIpcSend('process-monitor-event', {
            type: 'error',
            processName: 'up366.exe',
            pid: null,
            timestamp: new Date().toISOString(),
            message: errMsg
          });
          this.stop();
          return;
        }

        if (line.startsWith('EVENT:')) {
          this._handleEvent(line);
        }
      });
    });

    this.psProcess.stderr.on('data', (data) => {
      const errText = data.toString().trim();
      if (errText) {
        console.error('[ProcessMonitor] PowerShell stderr:', errText);
        this.safeIpcSend('process-monitor-event', {
          type: 'error',
          processName: 'up366.exe',
          pid: null,
          timestamp: new Date().toISOString(),
          message: errText
        });
      }
    });

    this.psProcess.on('close', (code) => {
      console.log(`[ProcessMonitor] PowerShell 进程退出，退出码: ${code}`);
      if (this.isMonitoring) {
        this.isMonitoring = false;
        this.psProcess = null;
        this.safeIpcSend('process-monitor-event', {
          type: 'stopped',
          processName: 'up366.exe',
          pid: null,
          timestamp: new Date().toISOString(),
          message: `WMI监控进程退出 (退出码: ${code})`
        });
      }
    });

    this.psProcess.on('error', (err) => {
      console.error('[ProcessMonitor] 启动失败:', err.message);
      this.isMonitoring = false;
      this.psProcess = null;
      this.safeIpcSend('process-monitor-event', {
        type: 'error',
        processName: 'up366.exe',
        pid: null,
        timestamp: new Date().toISOString(),
        message: '启动进程监控失败: ' + err.message
      });
    });

    return { success: true, message: '进程监控已启动' };
  }

  stop() {
    if (!this.isMonitoring) return { success: true, message: '进程监控未在运行' };

    if (this.psProcess && !this.psProcess.killed) {
      try {
        this.psProcess.kill();
      } catch (e) {
        console.error('[ProcessMonitor] 终止进程失败:', e.message);
      }
    }

    this.isMonitoring = false;
    this.psProcess = null;
    this.isUp366Running = false;

    this.safeIpcSend('process-monitor-event', {
      type: 'stopped',
      processName: 'up366.exe',
      pid: null,
      timestamp: new Date().toISOString(),
      message: '进程监控已手动停止'
    });

    return { success: true, message: '进程监控已停止' };
  }

  async _handleEvent(line) {
    const content = line.substring(6);
    const parts = content.split('|');
    if (parts.length < 4) return;

    const eventType = parts[0];
    const processName = parts[1];
    const pid = parseInt(parts[2], 10);
    const timestamp = parts.slice(3).join('|');

    this.safeIpcSend('process-monitor-event', {
      type: eventType === 'START' ? 'started' : 'stopped',
      processName,
      pid: isNaN(pid) ? null : pid,
      timestamp
    });

    const { count, pids } = await this._queryProcessCount();
    this._updateState(count, pids);
  }

  _queryProcessCount() {
    return new Promise((resolve) => {
      const queryScript = `
$all = Get-CimInstance Win32_Process -Filter "Name='up366.exe'" -ErrorAction SilentlyContinue
$instances = $all | Where-Object { $_.CommandLine -like '*--type=renderer*' }
$count = @($instances).Count
if ($count -gt 0) {
    $pids = ($instances | ForEach-Object { $_.ProcessId }) -join ','
    [Console]::WriteLine("COUNT:$count|" + $pids)
} else {
    [Console]::WriteLine("COUNT:0|")
}
`;
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', queryScript
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      ps.stdout.on('data', (data) => { output += data.toString(); });
      ps.stderr.on('data', (data) => {
        console.error('[ProcessMonitor] 查询进程计数 stderr:', data.toString().trim());
      });
      ps.on('close', (code) => {
        const line = output.trim();
        if (line.startsWith('COUNT:')) {
          const cntContent = line.substring(6);
          const cntParts = cntContent.split('|');
          const count = parseInt(cntParts[0], 10) || 0;
          const pids = cntParts[1] ? cntParts[1].split(',').map(Number).filter(n => !isNaN(n)) : [];
          resolve({ count, pids });
        } else {
          resolve({ count: 0, pids: [] });
        }
      });
      ps.on('error', (err) => {
        console.error('[ProcessMonitor] 查询进程计数失败:', err.message);
        resolve({ count: 0, pids: [] });
      });
    });
  }

  _updateState(count, pids) {
    const wasRunning = this.isUp366Running;
    this.isUp366Running = count >= 1;

    this.safeIpcSend('process-monitor-event', {
      type: 'count-updated',
      processName: 'up366.exe',
      count,
      pids,
      isRunning: this.isUp366Running,
      timestamp: new Date().toISOString()
    });

    if (wasRunning !== this.isUp366Running) {
      this.safeIpcSend('process-monitor-event', {
        type: 'state-changed',
        processName: 'up366.exe',
        previousState: wasRunning,
        currentState: this.isUp366Running,
        count,
        pids,
        timestamp: new Date().toISOString()
      });
    }
  }

  getUp366Path() {
    try {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\up366-2016';
      const result = execSync(`reg query "${regPath}" /v DisplayIcon`, { encoding: 'utf8' });
      const match = result.match(/DisplayIcon\s+REG_SZ\s+(.+)/);
      if (match && match[1]) {
        let exePath = match[1].trim();
        exePath = exePath.replace(/^"|"$/g, '');
        if (fs.existsSync(exePath)) {
          return exePath;
        }
      }
      return null;
    } catch (error) {
      console.error('[ProcessMonitor] 读取天学网注册表路径失败:', error);
      return null;
    }
  }

  async openUp366() {
    const up366Path = this.getUp366Path();
    if (up366Path) {
      try {
        await shell.openPath(up366Path);
        return { success: true, path: up366Path };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: '未找到天学网安装路径' };
  }

  async killUp366() {
    try {
      const result = execSync('taskkill /f /im up366.exe /t 2>&1', { encoding: 'utf8' });
      return { success: true, output: result.trim() };
    } catch (error) {
      if (error.stdout && error.stdout.includes('没有找到')) {
        return { success: true, output: '没有找到运行中的天学网进程' };
      }
      return { success: false, error: error.stderr || error.message };
    }
  }

  safeIpcSend(channel, data) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    } catch (error) {
      console.error('[ProcessMonitor] 发送IPC消息失败:', error.message);
    }
  }

  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;

    ipcMain.handle('start-process-monitor', async () => {
      return this.start(mainWindow);
    });

    ipcMain.handle('stop-process-monitor', async () => {
      return this.stop();
    });

    ipcMain.handle('get-process-monitor-status', async () => {
      return { running: this.isMonitoring, isUp366Running: this.isUp366Running };
    });

    ipcMain.handle('open-up366', async () => {
      try {
        return await this.openUp366();
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('kill-up366', async () => {
      try {
        return await this.killUp366();
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }
}

module.exports = ProcessMonitor;
