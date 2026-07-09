/*
 * SpeedUI —— 进程加速页面渲染层
 * --------------------------------------------------------
 * 拉条 1-1000× 控制天学网(up366.exe)全部进程的加速倍率。
 * 倍率越高: 数字/轨道/滑块整体呈单一颜色, 沿 蓝→青→绿→黄→橙→红 连续变化
 * (对数刻度, 三个数量级上过渡均匀, 无生硬分段; 终点为红色)。
 * 通过 electronAPI IPC → main → SpeedManager → injector 生效。
 */

const SPEED_MIN = 1;
const SPEED_MAX = 1000;

export default class SpeedUI {
  constructor() {
    this.slider = null;
    this.valueEl = null;
    this.statusEl = null;
    this.infoEl = null;
    this.page = null;

    this.currentFactor = 1;    // 当前倍率(1 = 正常速度)
    this.debounceTimer = null;
  }

  init() {
    this.slider = document.getElementById('speed-slider');
    this.valueEl = document.getElementById('speed-value');
    this.statusEl = document.getElementById('speed-status');
    this.infoEl = document.getElementById('speed-info');
    this.page = document.querySelector('.speed-page');
    if (!this.slider || !this.page) return;

    // 滑块拖动: 实时更新显示 + 防抖下发
    this.slider.addEventListener('input', () => {
      this.currentFactor = Number(this.slider.value);
      this._updateDisplay();
      this._debounceSend();
    });

    // 滑块放下时精确下发
    this.slider.addEventListener('change', () => {
      this._sendSpeed();
    });

    // 底部致谢链接: 用系统浏览器打开
    this.page.querySelectorAll('.speed-page__link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const url = a.getAttribute('data-url');
        if (url && window.electronAPI && window.electronAPI.openUrl) {
          window.electronAPI.openUrl(url);
        }
      });
    });

    // 监听主进程状态推送
    if (window.electronAPI && window.electronAPI.onSpeedStatus) {
      window.electronAPI.onSpeedStatus((data) => {
        this._handleStatus(data);
      });
    }

    // 恢复上次状态
    this._restoreState();
    this._updateDisplay();
  }

  // ===== 颜色: 沿倍率连续渐变(对数刻度) =====
  // t ∈ [0,1]: f=1 → 0, f=1000 → 1(对数, 使三个数量级上色彩均匀)
  _norm(f) {
    const t = Math.log(f) / Math.log(SPEED_MAX);
    return Math.max(0, Math.min(1, t));
  }

  // 由倍率算出 HSL 颜色: 212°(蓝) → 0°(红), 途经青/绿/黄/橙, 终点为红(非品红)
  _hsl(f) {
    const t = this._norm(f);
    const hue = 212 * (1 - t);  // 212°(蓝) → 0°(红)
    const sat = 78 + 12 * t;    // 78% → 90%, 越快越浓
    const lig = 54 - 6 * t;     // 54% → 48%, 越快越深
    return `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${lig.toFixed(1)}%)`;
  }

  // ===== 滑块与显示 =====
  _updateDisplay() {
    const f = this.currentFactor;
    this.valueEl.textContent = Math.round(f).toString();
    this._applyColor();
  }

  // 数字 / 轨道已填充段 / 滑块把手 统一用「当前倍率的单一颜色」,
  // 随倍率整体平滑变色(不保留途经色, 不做彩虹光谱)
  _applyColor() {
    const f = this.currentFactor;
    const pct = ((f - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
    const accent = this._hsl(f);

    // 已填充段: 单一当前色; 未填充段: 中性凹槽
    this.slider.style.background =
      `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct.toFixed(2)}%, ` +
      `var(--color-gray-200) ${pct.toFixed(2)}%, var(--color-gray-200) 100%)`;

    this.slider.style.setProperty('--speed-accent', accent);
    this.valueEl.style.color = accent;
    this.page.style.setProperty('--speed-accent', accent);
  }

  // ===== IPC 通信 =====
  _debounceSend() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this._sendSpeed(), 150);
  }

  async _sendSpeed() {
    const f = this.currentFactor;
    if (f <= SPEED_MIN) {
      // 倍率归 1 = 恢复正常速度
      this.statusEl.textContent = '正常速度';
      localStorage.removeItem('a366_speed_factor');
      if (window.electronAPI && window.electronAPI.resetSpeed) {
        await window.electronAPI.resetSpeed();
      }
      return;
    }
    this.statusEl.textContent = '设置中...';
    localStorage.setItem('a366_speed_factor', String(f));
    if (window.electronAPI && window.electronAPI.setSpeed) {
      try {
        const res = await window.electronAPI.setSpeed(f);
        if (res && res.success) {
          this.statusEl.textContent = '加速中 ' + Math.round(f) + '×';
        } else {
          this.statusEl.textContent = '设置失败: ' + (res ? res.error : '未知错误');
        }
      } catch (e) {
        this.statusEl.textContent = '通信失败: ' + e.message;
      }
    }
  }

  _handleStatus(data) {
    if (!data) return;
    if (data.type === 'success' && data.message) {
      this.infoEl.textContent = data.message;
    } else if (data.type === 'error') {
      this.infoEl.textContent = '⚠ ' + (data.message || '错误');
      this.infoEl.style.color = 'var(--color-danger-500)';
      setTimeout(() => { this.infoEl.style.color = ''; }, 3000);
    } else if (data.message) {
      this.infoEl.textContent = data.message;
    }
  }

  // 恢复上次设置的倍率(页面重载/重启后, 不自动重发)
  _restoreState() {
    const saved = localStorage.getItem('a366_speed_factor');
    if (saved) {
      const f = parseFloat(saved);
      if (Number.isFinite(f) && f > SPEED_MIN) {
        this.currentFactor = Math.min(f, SPEED_MAX);
        this.slider.value = this.currentFactor;
        this.statusEl.textContent = '上次: ' + Math.round(this.currentFactor) + '× (拖动滑块重新启用)';
      }
    }
  }
}
