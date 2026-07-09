/*
 * ThemeUI —— 颜色模式(深色/浅色)切换
 * --------------------------------------------------------
 * - 默认跟随系统 (prefers-color-scheme), 系统切换时自动跟随。
 * - 点击切换按钮: 切到与当前相反的模式, 并记住该选择(此后不再跟随系统,
 *   直到用户再次点击)。两套 UI 各有一个按钮:
 *     标准 UI: 侧栏底部 #themeToggleBtn
 *     简易 UI: 简易主页右上角 #themeToggleBtnSimple
 * - 首帧前的应用在 index.html 的内联脚本里完成(防闪白), 本模块负责按钮联动、
 *   系统变化监听, 以及切换时给 <html> 挂 .theme-switching 做统一淡变过渡。
 * 生效方式: 在 <html> 上写 data-theme="dark|light", 由 styles/global/theme.css 接管。
 */

const STORE_KEY = 'a366-theme';

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
    this._apply(this._resolve(), false);
    this._updateButtons();

    this.btns.forEach((btn) => {
      btn.addEventListener('click', () => this.toggle());
      // 标准 UI 的切换项是 div[role=button], 需手动支持 Enter/空格(原生 button 无需)
      if (btn.tagName !== 'BUTTON') {
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
        });
      }
    });

    // 系统主题变化: 仅在用户未显式选择时跟随
    const onSystemChange = () => {
      if (!this._hasExplicitChoice()) {
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

  _hasExplicitChoice() {
    const v = localStorage.getItem(STORE_KEY);
    return v === 'light' || v === 'dark';
  }

  // 计算应生效的模式: 显式选择优先, 否则跟随系统
  _resolve() {
    const v = localStorage.getItem(STORE_KEY);
    if (v === 'light' || v === 'dark') return v;
    return this.mql.matches ? 'dark' : 'light';
  }

  // 当前实际生效的模式(读 DOM, 与内联脚本保持一致)
  _current() {
    return document.documentElement.getAttribute('data-theme') || this._resolve();
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

  // 点击: 切到相反模式并记住
  toggle() {
    const next = this._current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORE_KEY, next);
    this._apply(next, true);
    this._updateButtons();

    if (window.electronAPI && window.electronAPI.captureEvent) {
      window.electronAPI.captureEvent('theme_switched', { theme: next });
    }
  }

  // 图标/文案: 当前深色 → 显示"太阳/浅色模式"(点击去浅色); 反之显示"月亮/深色模式"
  _updateButtons() {
    const dark = this._current() === 'dark';
    const iconClass = dark ? 'bi bi-brightness-high' : 'bi bi-moon-stars';
    const labelText = dark ? '浅色模式' : '深色模式';
    const title = dark ? '切换到浅色模式' : '切换到深色模式';
    this.btns.forEach((btn) => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('span');
      if (icon) icon.className = iconClass;
      if (label) label.textContent = labelText;
      btn.title = title;
    });
  }
}
