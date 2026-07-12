/*
 * ThemeUI —— 颜色模式(系统跟随/深色/浅色)切换
 * --------------------------------------------------------
 * - 三种模式: system(跟随系统)、dark(深色)、light(浅色)
 * - 点击切换按钮: 在三种模式间循环 system → dark → light → system
 * - 两套 UI 各有一个按钮:
 *     标准 UI: 侧栏底部 #themeToggleBtn
 *     简易 UI: 简易主页右上角 #themeToggleBtnSimple
 * - 设置页 select 与按钮双向同步
 * - 首帧前的应用在 index.html 的内联脚本里完成(防闪白), 本模块负责按钮联动、
 *   系统变化监听, 以及切换时给 <html> 挂 .theme-switching 做统一淡变过渡。
 * 生效方式: 在 <html> 上写 data-theme="dark|light", 由 styles/global/theme.css 接管。
 */

const STORE_KEY = 'a366-theme';
const THEMES = ['system', 'dark', 'light'];

export default class ThemeUI {
  constructor() {
    this.btns = [];
    this.mql = window.matchMedia('(prefers-color-scheme: dark)');
    this._twTimer = null;
  }

  init() {
    this.btns = ['themeToggleBtn', 'themeToggleBtnSimple']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    // 确保 data-theme 已就位(内联脚本通常已设置; 这里兜底, 不做动画避免初始闪变)
    this._apply(this._resolveEffective(), false);
    this._updateButtons();
    this._syncSelect();

    this.btns.forEach((btn) => {
      btn.addEventListener('click', () => this.toggle());
      // 标准 UI 的切换项是 div[role=button], 需手动支持 Enter/空格(原生 button 无需)
      if (btn.tagName !== 'BUTTON') {
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
        });
      }
    });

    // 系统主题变化: 仅在 system 模式下跟随
    const onSystemChange = () => {
      if (this._getStored() === 'system') {
        this._apply(this.mql.matches ? 'dark' : 'light', true);
        this._updateButtons();
      }
    };
    if (this.mql.addEventListener) {
      this.mql.addEventListener('change', onSystemChange);
    } else if (this.mql.addListener) {
      this.mql.addListener(onSystemChange); // 兼容旧接口
    }
  }

  // 获取 localStorage 中存储的偏好值
  _getStored() {
    const v = localStorage.getItem(STORE_KEY);
    // 兼容旧版本：只有 'light'/'dark' 没有值时默认 system
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    return 'system';
  }

  // 根据存储的偏好计算实际生效的主题
  _resolveEffective() {
    const stored = this._getStored();
    if (stored === 'dark' || stored === 'light') return stored;
    return this.mql.matches ? 'dark' : 'light';
  }

  // 当前实际生效的模式(读 DOM)
  _current() {
    return document.documentElement.getAttribute('data-theme') || this._resolveEffective();
  }

  // animate=true 时挂 .theme-switching, 让所有元素统一淡变, 结束后移除
  _apply(theme, animate) {
    const root = document.documentElement;
    if (animate) {
      root.classList.add('theme-switching');
      clearTimeout(this._twTimer);
      this._twTimer = setTimeout(() => root.classList.remove('theme-switching'), 350);
    }
    root.setAttribute('data-theme', theme);
  }

  // 点击按钮: 在三种模式间循环
  toggle() {
    const stored = this._getStored();
    const idx = THEMES.indexOf(stored);
    const next = THEMES[(idx + 1) % THEMES.length];
    this.setTheme(next);
  }

  // 设置主题偏好（供按钮和设置页调用）
  setTheme(preference) {
    localStorage.setItem(STORE_KEY, preference);
    this._apply(this._resolveEffective(), true);
    this._updateButtons();
    this._syncSelect();

    if (window.electronAPI && window.electronAPI.captureEvent) {
      window.electronAPI.captureEvent('theme_switched', { theme: preference });
    }
  }

  // 图标/文案: 根据 _getStored() 显示对应提示
  _updateButtons() {
    const stored = this._getStored();
    let iconClass, labelText, title;
    if (stored === 'system') {
      const effective = this._current();
      iconClass = effective === 'dark' ? 'bi bi-circle-half' : 'bi bi-circle-half';
      labelText = '跟随系统';
      title = '当前跟随系统';
    } else if (stored === 'dark') {
      iconClass = 'bi bi-brightness-high';
      labelText = '浅色模式';
      title = '切换到跟随系统';
    } else {
      iconClass = 'bi bi-moon-stars';
      labelText = '深色模式';
      title = '切换到深色模式';
    }
    this.btns.forEach((btn) => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('span');
      if (icon) icon.className = iconClass;
      if (label) label.textContent = labelText;
      btn.title = title;
    });
  }

  // 同步设置页的 select
  _syncSelect() {
    const select = document.getElementById('themeSelect');
    if (select) select.value = this._getStored();
  }
}
