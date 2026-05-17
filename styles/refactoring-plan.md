# Auto366 样式与 UI 架构重构方案

> 生成日期：2026-05-16

---

## 一、现状分析

### 1.1 当前样式文件结构

| 文件 | 行数 | 职责 |
|------|------|------|
| `styles/tokens.css` | 30 | CSS 变量定义（设计令牌） |
| `styles/base.css` | 790 | 基础布局、侧边栏、面板、Simple 模式覆盖 |
| `styles/ui.css` | ~4530 | **所有组件样式混杂在一起** |
| `styles/titlebar.css` | 120 | 自定义标题栏 |
| `styles/app.css` | 5 | 仅作为 `@import` 入口 |

### 1.2 核心问题清单

#### 问题 1：`ui.css` 严重臃肿（~4530 行）

所有组件样式（按钮、模态框、卡片、表单、日志、规则、答案、社区、设置、赞赏、教程等）全部堆在一个文件中，缺乏模块化管理。

#### 问题 2：样式重复定义严重

以下为已识别的重复定义：

| 重复组件 | 出现次数 | 位置 |
|----------|----------|------|
| `toggle-switch` / `toggle-slider` | **4 次** | `.toggle-switch`、`.switch`、`.rule-toggle`、`.rule-toggle-slider` |
| `modal` / `modal-content` / `modal-header` / `modal-body` / `modal-footer` | **3 次** | 行 393-425、行 1993-2052、行 2680-2713，且各次定义不一致 |
| `copy-toast` | **2 次** | 行 995-1024 和行 1526-1551，完全重复 |
| `answer-count` | **2 次** | 行 764-770 和行 1121-1128，属性略有不同 |
| `rule-btn` | **2 次** | 行 2204-2218 和行 2586-2597，border 定义不同 |
| `rule-details` / `rule-detail-item` / `rule-detail-label` / `rule-detail-value` | **2 次** | 行 2166-2201 和行 2623-2661 |
| `modalSlideIn` 动画 | **2 次** | 行 415-425 和行 2702-2713 |
| `rule-description` | **3 次** | 行 1864-1869、行 2309-2315、行 2529-2533 |
| `rule-type` | **2 次** | 行 1833-1842 和行 2283-2292 |
| `rule-status` | **2 次** | 行 1844-1862 和行 2663-2678 |

#### 问题 3：Design Tokens 覆盖率极低

大量硬编码颜色/数值散布在 `ui.css` 中：

| 硬编码值 | 出现次数 | 对应 Token（未使用） |
|----------|----------|---------------------|
| `#007bff` | ~120+ 次 | `--color-primary` |
| `#f8f9fa` | ~60+ 次 | `--color-bg-muted` |
| `#e9ecef` | ~80+ 次 | `--color-border` |
| `#6c757d` | ~90+ 次 | `--color-text-muted` |
| `#495057` | ~50+ 次 | `--color-text-heading` |
| `6px` / `8px` / `12px` / `16px` | 大量 | `--radius-*` / `--space-*` |

**tokens.css 中定义的变量在实际组件中几乎未被使用。**

#### 问题 4：命名体系混乱

多种命名风格混用，缺乏一致性：

```css
.btn--primary                      /* BEM 风格 */
.primary-btn                       /* 前缀命名 */
.action-btn.closing                /* 状态修饰类 */
.donation-modal                    /* 组件前缀命名 */
#simple-home .container            /* ID + 类（高特异性） */
.cp-cluster.cp-status              /* 多类组合 */
html[data-ui="simple"][data-simple-page="app"] .control-panel > .control-group button  /* 深层嵌套 */
```

#### 问题 5：Simple 模式样式耦合严重

约 **200+ 行** 的 `html[data-ui="simple"]` 选择器散布在 `base.css` 和 `ui.css` 中，导致：

- 组件本身不知道自己的默认形态
- Simple 模式修改需要同时修改多处
- 选择器特异性极高，最长选择器达 **7 层嵌套**
- 无法通过 CSS 变量实现优雅降级

#### 问题 6：赞赏组件重复三遍

同一段赞赏代码（图标+弹窗+二维码）在三处出现：

1. `#simple-home` 内（`index.html` 行 57-94）
2. `#settings-view` 内（`index.html` 行 440-478）
3. `.donation-modal` 内（`ui.css` 行 3618-3860）

CSS 中使用 `#simple-home .xxx, #settings-view .xxx` 选择器强行合并，维护成本高。

---

## 二、重构目标

| 目标 | 说明 |
|------|------|
| 模块化拆分 | 将 `ui.css` 拆分为按组件/功能划分的独立文件 |
| 消除重复 | 合并所有重复定义的组件，实现单一数据源 |
| Design Tokens 全覆盖 | 让 tokens.css 真正成为样式的唯一数据源 |
| 统一命名规范 | 建立一致的 BEM 风格组件命名体系 |
| 解耦 Simple 模式 | 通过 CSS 变量和语义化 class 实现模式切换 |
| 减少选择器特异性 | 避免深层嵌套，最大嵌套不超过 3 层 |
| **全面刷新** | CSS 使用新命名，JS 同步更新，不保留旧类名别名，代码干净无历史包袱 |
| **零遗漏** | 通过自动化提取清单 + 交叉验证机制，确保不遗漏任何组件 |

---

## 三、重构后的目录结构

```
styles/
├── app.css                      # @import 入口（更新导入列表）
├── tokens.css                   # 设计令牌（大幅扩展）
├── base.css                     # 全局基础样式（精简）
├── titlebar.css                 # 自定义标题栏
├── layout.css                   # 页面布局（从 base.css 拆分）
├── components/                  # 可复用 UI 组件
│   ├── buttons.css              # 所有按钮变体
│   ├── modals.css               # 模态框系统
│   ├── forms.css                # 表单元素
│   ├── toggles.css              # 开关/滑块
│   ├── cards.css                # 卡片容器
│   ├── badges.css               # 状态徽章
│   └── toast.css                # 提示浮层
├── features/                    # 功能区域样式
│   ├── control-panel.css        # 控制面板
│   ├── answers.css              # 答案获取视图
│   ├── rules.css                # 规则管理视图
│   ├── community.css            # 社区规则集视图
│   ├── settings.css             # 设置视图
│   ├── logs.css                 # 日志监听区域
│   └── simple-mode.css          # Simple 模式专属覆盖
└── views/                       # 页面级视图
    ├── simple-home.css          # 简易首页
    ├── appreciation.css         # 赞赏组件（统一一处）
    └── tutorial.css             # 新手教程
```

---

## 四、防遗漏机制设计

### 4.1 问题根源分析

AI 重构时容易遗漏组件的根本原因：

1. **类名提取不完整** — 仅通过搜索关键词找到的类名可能遗漏隐藏在深层嵌套中的选择器
2. **CSS 选择器复杂度高** — 如 `html[data-ui="simple"][data-simple-page="app"] .control-panel > .control-group button` 这种选择器容易被忽略
3. **JS 动态生成的类名** — `innerHTML` 模板中的类名无法通过 grep 搜索静态文件完全找到
4. **缺乏系统性验证** — 没有自动化的验证机制来确认重构是否完整

### 4.2 解决方案：三层防遗漏体系

#### 第一层：完整类名提取清单

**从 `ui.css` 中提取所有 CSS 类名，生成完整的迁移清单。**

提取规则：
1. 使用正则表达式匹配所有 `.` 开头的类名
2. 排除伪类（`:hover`、`:focus`、`:active`、`:last-child` 等）
3. 排除属性选择器（`[type="checkbox"]` 等）
4. 保留复合选择器中的所有类名
5. 按行号排序，标注所在文件位置

**生成文件**：`styles/refactoring-checklist.md` — 包含所有类名的完整清单，每个类名标记：
- 原始位置（文件:行号）
- 是否重复定义
- 是否被 JS 引用
- 新类名
- 迁移状态（待迁移 / 已迁移 / 已验证）

#### 第二层：JS 引用交叉验证

**扫描所有 JS 文件，提取所有类名引用，与 CSS 类名清单交叉验证。**

提取规则：
1. 搜索所有 `querySelector` / `querySelectorAll` 中的类名
2. 搜索所有 `classList.add` / `classList.remove` / `classList.toggle` 中的类名
3. 搜索所有 `className = '...'` / `className += '...'` 中的类名
4. 搜索所有 `innerHTML` / `insertAdjacentHTML` 模板中的类名
5. 搜索所有 `getElementById` 元素的 class 属性

**生成文件**：`styles/js-class-usage.md` — 包含所有 JS 类名引用的清单，每个引用标记：
- 所在文件:行号
- 使用方式（查询 / 添加 / 移除 / 切换 / 模板）
- 对应的 CSS 类名
- 迁移状态

#### 第三层：自动化验证脚本

**提供 PowerShell 脚本，自动检查遗漏。**

**脚本 1**：`scripts/check-old-classes.ps1`
- 扫描所有 CSS 文件，检查是否还有旧类名残留
- 扫描所有 JS 文件，检查是否还有旧类名引用
- 输出未迁移的类名列表

**脚本 2**：`scripts/verify-new-classes.ps1`
- 扫描所有新 CSS 文件，验证新类名是否存在
- 扫描所有 JS 文件，验证新类名引用是否正确
- 输出验证报告

### 4.3 实施流程

```
Step 1: 提取完整类名清单
    │ 从 ui.css 中提取所有类名 → checklist.md
    │ 从 base.css 中提取所有类名 → 追加到 checklist.md
    │ 从 titlebar.css 中提取所有类名 → 追加到 checklist.md
    │
    ▼
Step 2: 提取 JS 引用清单
    │ 扫描所有 renderer/*.js → js-class-usage.md
    │
    ▼
Step 3: 交叉验证
    │ 比对 checklist.md 和 js-class-usage.md
    │ 标记冲突项（JS 引用但 CSS 未定义的类名）
    │
    ▼
Step 4: 开始重构（按 Phase 顺序）
    │ Phase 1: tokens.css
    │ Phase 2: components/*
    │ Phase 3: features/*
    │ Phase 4: views/*
    │ Phase 5: layout.css + base.css
    │ Phase 6: JS 类名更新
    │ Phase 7: HTML 结构调整
    │ Phase 8: app.css 更新
    │
    ▼
Step 5: 每完成一个 Phase 运行验证脚本
    │ check-old-classes.ps1 → 检查旧类名残留
    │ verify-new-classes.ps1 → 检查新类名完整性
    │
    ▼
Step 6: 最终验证
    │ 启动应用，手动测试所有功能
    │ 确认 checklist.md 中所有项状态为"已验证"
```

### 4.4 检查清单模板

每个组件在 `refactoring-checklist.md` 中的记录格式：

```markdown
## [组件名称]

| 旧类名 | 文件:行号 | 重复 | JS引用 | 新类名 | 状态 |
|--------|-----------|------|--------|--------|------|
| .xxx | ui.css:123 | 否 | 是(.btn) | .btn--primary | ✅ 已验证 |
```

### 4.5 验证脚本设计

#### `scripts/check-old-classes.ps1`

```powershell
# 从 checklist.md 提取所有旧类名
$oldClasses = Get-Content "styles/refactoring-checklist.md" | 
    Where-Object { $_ -match '^\| \.' } | 
    ForEach-Object { ($_ -split '\|')[1].Trim() } | 
    Where-Object { $_ -ne "旧类名" }

# 扫描 CSS 文件
$cssFiles = Get-ChildItem "styles" -Recurse -Filter "*.css" | 
    Where-Object { $_.Name -ne "ui.css" -and $_.Name -ne "base.css" }

foreach ($class in $oldClasses) {
    $cleanClass = $class.TrimStart('.')
    foreach ($file in $cssFiles) {
        $content = Get-Content $file.FullName -Raw
        if ($content -match "\b$cleanClass\b") {
            Write-Host "⚠️ 旧类名残留: $class 在 $($file.Name)" -ForegroundColor Yellow
        }
    }
}

# 扫描 JS 文件
$jsFiles = Get-ChildItem "renderer" -Recurse -Filter "*.js"

foreach ($class in $oldClasses) {
    $cleanClass = $class.TrimStart('.')
    foreach ($file in $jsFiles) {
        $content = Get-Content $file.FullName -Raw
        if ($content -match "'$cleanClass'|`"$cleanClass`"") {
            Write-Host "⚠️ 旧类名引用: $class 在 $($file.Name)" -ForegroundColor Yellow
        }
    }
}
```

---

## 五、新旧类名完整映射表

### 5.1 按钮类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.primary-btn` | `.btn--primary` | `app.js`, `proxy-ui.js`, `answers-ui.js`, `community-ui.js`, `settings-ui.js` |
| `.secondary-btn` | `.btn--ghost` | `answers-ui.js`, `proxy-ui.js`, `settings-ui.js` |
| `.danger-btn` | `.btn--danger` | `app.js`, `proxy-ui.js`, `settings-ui.js` |
| `.action-btn` | `.btn--action` | `proxy-ui.js` |
| `.action-btn.restart` | `.btn--action.is-restart` | `proxy-ui.js` |
| `.action-btn.closing` | `.btn--action.is-closing` | `proxy-ui.js` |
| `.action-btn.closing.done` | `.btn--action.is-closing.is-done` | `proxy-ui.js` |
| `.export-btn` | `.btn--export` | `answers-ui.js` |
| `.share-btn` | `.btn--share` | `answers-ui.js` |
| `.import-btn` | `.btn--import` | `answers-ui.js` |
| `.settings-btn` | `.btn--settings` | `app.js` |
| `.add-rule-btn` | `.btn--add-rule` | `rules-ui.js` |
| `.rule-btn` | `.btn--rule` | `rules-ui.js` |
| `.rule-btn.edit-btn` | `.btn--rule.btn--edit` | `rules-ui.js` |
| `.rule-btn.delete-btn` | `.btn--rule.btn--delete` | `rules-ui.js` |
| `.rule-btn.reset-btn` | `.btn--rule.btn--reset` | `rules-ui.js` |
| `.install-btn` | `.btn--install` | `community-ui.js` |
| `.install-btn.installed` | `.btn--install.is-installed` | `community-ui.js` |
| `.view-details-btn` | `.btn--view-details` | `community-ui.js` |
| `.download-response-btn` | `.btn--download` | `logs-ui.js` |
| `.copy-answer-btn` | `.btn--copy` | `answers-ui.js` |
| `.copy-child-answer-btn` | `.btn--copy` | `answers-ui.js` |
| `.expand-answer-btn` | `.btn--expand` | `answers-ui.js` |
| `.close-btn` | `.btn--close` | `answers-ui.js`, `rules-ui.js` |
| `.modal-close` | `.btn--close` | `proxy-ui.js` |
| `.sort-btn` | `.btn--sort` | `answers-ui.js` |
| `.sort-btn.active` | `.btn--sort.is-active` | `answers-ui.js` |
| `.copy-url-btn` | `.btn--copy` | `answers-ui.js` |
| `.open-url-btn` | `.btn--open` | `answers-ui.js` |
| `.open-btn` | `.btn--open` | `answers-ui.js` |
| `.btn-small` | `.btn--sm` | `settings-ui.js` |
| `.btn-cancel` | `.btn--cancel` | `settings-ui.js` |
| `.btn-danger` | `.btn--danger` | `settings-ui.js` |
| `.retry-btn` | `.btn--retry` | `community-ui.js` |
| `.update-btn-cancel` | `.btn--cancel` | `settings-ui.js` |
| `.update-btn-download` | `.btn--primary` | `settings-ui.js` |
| `.tutorial-btn-primary` | `.btn--primary` | `tutorial-ui.js` |
| `.tutorial-btn-secondary` | `.btn--ghost` | `tutorial-ui.js` |
| `.donation-btn-later` | `.btn--ghost` | `app.js` |
| `.update-btn` | `.btn--update` | `app.js` |
| `.update-btn.has-update` | `.btn--update.has-update` | `app.js`, `settings-ui.js` |
| `.donation-modal-close` | `.btn--close` | `app.js` |
| `.update-panel-close` | `.btn--close` | `settings-ui.js` |
| `.settings-btn` | `.btn--icon` | `events.js` |

### 5.2 模态框类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.modal` | `.modal` | `rules-ui.js` |
| `.modal-overlay` | `.modal` | `proxy-ui.js` |
| `.modal-content` | `.modal__content` | `answers-ui.js`, `proxy-ui.js` |
| `.modal-header` | `.modal__header` | `answers-ui.js`, `proxy-ui.js` |
| `.modal-body` | `.modal__body` | `answers-ui.js`, `proxy-ui.js` |
| `.modal-footer` | `.modal__footer` | `answers-ui.js`, `proxy-ui.js` |
| `.donation-modal` | `.modal--donation` | `app.js` |
| `.donation-modal-content` | `.modal__content` | `app.js` |
| `.donation-modal-header` | `.modal__header` | `app.js` |
| `.donation-modal-body` | `.modal__body` | `app.js` |
| `.donation-modal-footer` | `.modal__footer` | `app.js` |
| `.donation-modal-close` | `.modal__close` | `app.js` |
| `.tutorial-modal` | `.modal--tutorial` | `tutorial-ui.js` |
| `.ruleset-detail-modal` | `.modal--ruleset-detail` | `community-ui.js` |
| `.share-result-modal` | `.modal--share` | `answers-ui.js` |
| `.update-panel` | `.modal--update` | `settings-ui.js` |
| `.update-panel-overlay` | `.modal--update .modal__overlay` | `settings-ui.js` |
| `.update-panel-content` | `.modal__content` | `settings-ui.js` |
| `.update-panel-header` | `.modal__header` | `settings-ui.js` |
| `.update-panel-body` | `.modal__body` | `settings-ui.js` |
| `.update-panel-close` | `.modal__close` | `settings-ui.js` |
| `.update-panel-footer` | `.modal__footer` | `settings-ui.js` |
| `.share-result-modal .modal-content` | `.modal__content` | `answers-ui.js` |
| `.share-result-modal .modal-header` | `.modal__header` | `answers-ui.js` |
| `.share-result-modal .modal-body` | `.modal__body` | `answers-ui.js` |

### 5.3 开关/Toggle 类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.toggle-switch` | `.toggle` | `proxy-ui.js` |
| `.toggle-slider` | `.toggle__slider` | `proxy-ui.js` |
| `.switch` | `.toggle` | `rules-ui.js` |
| `.slider` | `.toggle__slider` | `rules-ui.js` |
| `.rule-toggle` | `.toggle` | `rules-ui.js` |
| `.rule-toggle-slider` | `.toggle__slider` | `rules-ui.js` |
| `.disabled-by-parent` | `.toggle.is-disabled` | `rules-ui.js` |

### 5.4 徽章/Badge 类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.status-value.running` | `.badge--running` | HTML 静态 |
| `.status-value.stopped` | `.badge--stopped` | HTML 静态 |
| `.status-value.processing` | `.badge--processing` | HTML 静态 |
| `.compatible-badge.compatible` | `.badge--compatible` | `rules-ui.js` |
| `.compatible-badge.incompatible` | `.badge--incompatible` | `rules-ui.js` |
| `.installed-badge` | `.badge--installed` | `community-ui.js` |
| `.answer-count` | `.badge--count` | `answers-ui.js` |
| `.answer-type` | `.badge--type` | `answers-ui.js` |
| `.rule-type` | `.badge--rule-type` | HTML 静态 |
| `.rule-status.enabled` | `.badge--enabled` | HTML 静态 |
| `.rule-status.disabled` | `.badge--disabled` | HTML 静态 |
| `.ruleset-tag` | `.badge--tag` | `community-ui.js` |
| `.ruleset-tag.has-injection` | `.badge--tag.has-injection` | `community-ui.js` |
| `.log-method.GET` | `.badge--method.get` | `logs-ui.js` |
| `.log-method.POST` | `.badge--method.post` | `logs-ui.js` |

### 5.5 日志类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.log-item` | `.log-item` | `logs-ui.js`, `settings-ui.js` |
| `.log-item.success` | `.log-item--success` | `logs-ui.js` |
| `.log-item.error` | `.log-item--error` | `logs-ui.js` |
| `.log-item.normal` | `.log-item` | `logs-ui.js` |
| `.log-item.important` | `.log-item--important` | `logs-ui.js` |
| `.log-item.rule-success` | `.log-item--rule-success` | `logs-ui.js` |
| `.log-item.rule-error` | `.log-item--rule-error` | `logs-ui.js` |
| `.log-item.clickable` | `.log-item--clickable` | `logs-ui.js` |
| `.log-item.selected` | `.log-item--selected` | `logs-ui.js` |
| `.log-item-hidden` | `.log-item--hidden` | `logs-ui.js` |
| `.highlight-match` | `.log-item__highlight` | `logs-ui.js` |
| `.log-time` | `.log-item__time` | `logs-ui.js` |
| `.log-text` | `.log-item__text` | `logs-ui.js` |
| `.log-item.warning` | `.log-item--warning` | `settings-ui.js` |

### 5.6 规则类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.rule-group` | `.rule-group` | `rules-ui.js` |
| `.rule-group-header` | `.rule-group__header` | `rules-ui.js` |
| `.rule-group-info` | `.rule-group__info` | `rules-ui.js` |
| `.rule-group-name` | `.rule-group__name` | `rules-ui.js` |
| `.rule-group-description` | `.rule-group__description` | `rules-ui.js` |
| `.rule-group-actions` | `.rule-group__actions` | `rules-ui.js` |
| `.rule-group-content` | `.rule-group__content` | `rules-ui.js` |
| `.rule-item` | `.rule-item` | `rules-ui.js` |
| `.rule-item.enabled` | `.rule-item.is-enabled` | `rules-ui.js` |
| `.rule-item.disabled` | `.rule-item.is-disabled` | `rules-ui.js` |
| `.rule-header` | `.rule-item__header` | `rules-ui.js` |
| `.rule-info` | `.rule-item__info` | `rules-ui.js` |
| `.rule-name` | `.rule-item__name` | `rules-ui.js` |
| `.rule-description` | `.rule-item__description` | `rules-ui.js` |
| `.rule-actions` | `.rule-item__actions` | `rules-ui.js` |
| `.rule-config` | `.rule-item__config` | `rules-ui.js` |
| `.config-items` | `.rule-item__config-items` | `rules-ui.js` |
| `.config-item` | `.rule-item__config-item` | `rules-ui.js` |
| `.config-label` | `.rule-item__config-label` | `rules-ui.js` |
| `.config-value` | `.rule-item__config-value` | `rules-ui.js` |
| `.simple-clickable-group` | `.rule-group--clickable` | `rules-ui.js` |
| `.simple-group-enabled` | `.rule-group--enabled` | `rules-ui.js` |
| `.independent-rules` | `.rules-list--independent` | `rules-ui.js` |
| `.no-group-rules` | `.rules-list__empty` | `rules-ui.js` |
| `.no-rules` | `.rules-list__empty` | `rules-ui.js` |
| `.rule-fields` | `.rule-form__fields` | `rules-ui.js` |
| `.rule-count` | `.rules-list__count` | `rules-ui.js` |
| `.text-muted` | `.text--muted` | `rules-ui.js`, `community-ui.js` |

### 5.7 答案类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.answers-display` | `.answers-view` | HTML 静态 |
| `.answers-container` | `.answers-view__container` | HTML 静态 |
| `.no-answers` | `.answers-view__empty` | `answers-ui.js` |
| `.answer-group` | `.answer-group` | `answers-ui.js` |
| `.group-header` | `.answer-group__header` | `answers-ui.js` |
| `.answers-list` | `.answer-group__list` | `answers-ui.js` |
| `.answer-item` | `.answer-item` | `answers-ui.js` |
| `.has-children` | `.answer-item--has-children` | `answers-ui.js` |
| `.answer-header` | `.answer-item__header` | `answers-ui.js` |
| `.answer-index` | `.answer-item__index` | `answers-ui.js` |
| `.answer-type` | `.answer-item__type` | `answers-ui.js` |
| `.answer-content` | `.answer-item__content` | `answers-ui.js` |
| `.question` | `.answer-item__question` | `answers-ui.js` |
| `.main-answer` | `.answer-item__main` | `answers-ui.js` |
| `.answer` | `.answer-item__text` | `answers-ui.js` |
| `.children-answers` | `.answer-item__children` | `answers-ui.js` |
| `.child-answer-item` | `.child-answer` | `answers-ui.js` |
| `.child-answer-header` | `.child-answer__header` | `answers-ui.js` |
| `.child-answer-index` | `.child-answer__index` | `answers-ui.js` |
| `.child-answer-content` | `.child-answer__content` | `answers-ui.js` |
| `.clickable-answer` | `.answer-item__content--clickable` | `answers-ui.js` |
| `.answer-source` | `.answer-item__source` | `answers-ui.js` |
| `.answer-pattern` | `.answer-item__pattern` | `answers-ui.js` |
| `.answer-number` | `.answer-item__number` | `answers-ui.js` |
| `.answer-option` | `.answer-item__option` | `answers-ui.js` |
| `.legacy-answer-content` | `.answer-item__legacy` | `answers-ui.js` |
| `.import-export-section` | `.answers-view__toolbar` | HTML 静态 |

### 5.8 社区规则集类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.community-content` | `.community-view` | HTML 静态 |
| `.search-section` | `.community-view__search` | HTML 静态 |
| `.search-box` | `.community-view__search-box` | HTML 静态 |
| `.search-filters` | `.community-view__filters` | HTML 静态 |
| `.rulesets-container` | `.community-view__list` | HTML 静态 |
| `.loading-state` | `.community-view__loading` | `community-ui.js` |
| `.loading-spinner` | `.community-view__spinner` | `community-ui.js` |
| `.error-state` | `.community-view__error` | `community-ui.js` |
| `.error-message` | `.community-view__error-text` | `community-ui.js` |
| `.no-rulesets` | `.community-view__empty` | `community-ui.js` |
| `.ruleset-item` | `.ruleset-item` | `community-ui.js` |
| `.ruleset-item.installed` | `.ruleset-item.is-installed` | `community-ui.js` |
| `.ruleset-header` | `.ruleset-item__header` | `community-ui.js` |
| `.ruleset-info` | `.ruleset-item__info` | `community-ui.js` |
| `.ruleset-name` | `.ruleset-item__name` | `community-ui.js` |
| `.ruleset-description` | `.ruleset-item__description` | `community-ui.js` |
| `.ruleset-actions` | `.ruleset-item__actions` | `community-ui.js` |
| `.ruleset-author` | `.ruleset-item__author` | `community-ui.js` |
| `.ruleset-meta` | `.ruleset-item__meta` | `community-ui.js` |
| `.ruleset-downloads` | `.ruleset-item__downloads` | `community-ui.js` |
| `.ruleset-date` | `.ruleset-item__date` | `community-ui.js` |
| `.ruleset-tags` | `.ruleset-item__tags` | `community-ui.js` |
| `.detail-header` | `.modal--ruleset-detail .modal__header` | `community-ui.js` |
| `.detail-title` | `.modal--ruleset-detail .modal__title` | `community-ui.js` |
| `.detail-author` | `.modal--ruleset-detail .modal__author` | `community-ui.js` |
| `.detail-description` | `.modal--ruleset-detail .modal__description` | `community-ui.js` |
| `.detail-stats` | `.modal--ruleset-detail .modal__stats` | `community-ui.js` |
| `.detail-stat` | `.modal--ruleset-detail .modal__stat` | `community-ui.js` |
| `.detail-files` | `.modal--ruleset-detail .modal__files` | `community-ui.js` |
| `.file-list` | `.modal--ruleset-detail .modal__file-list` | `community-ui.js` |
| `.file-item` | `.modal--ruleset-detail .modal__file-item` | `community-ui.js` |
| `.file-info` | `.modal--ruleset-detail .modal__file-info` | `community-ui.js` |
| `.file-icon` | `.modal--ruleset-detail .modal__file-icon` | `community-ui.js` |
| `.file-name` | `.modal--ruleset-detail .modal__file-name` | `community-ui.js` |
| `.file-size` | `.modal--ruleset-detail .modal__file-size` | `community-ui.js` |

### 5.9 分享结果模态框类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.share-result-modal` | `.modal--share` | `answers-ui.js` |
| `.share-info` | `.modal--share .modal__info` | `answers-ui.js` |
| `.url-section` | `.modal--share .modal__url-section` | `answers-ui.js` |
| `.url-input-group` | `.modal--share .modal__url-input-group` | `answers-ui.js` |
| `.url-input` | `.modal--share .modal__url-input` | `answers-ui.js` |
| `.sort-info` | `.modal--share .modal__sort-info` | `answers-ui.js` |
| `.share-tips` | `.modal--share .modal__tips` | `answers-ui.js` |

### 5.10 日志详情类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.detail-section` | `.log-detail__section` | `logs-ui.js` |
| `.detail-item` | `.log-detail__item` | `logs-ui.js` |
| `.detail-label` | `.log-detail__label` | `logs-ui.js` |
| `.detail-value` | `.log-detail__value` | `logs-ui.js` |
| `.detail-json` | `.log-detail__json` | `logs-ui.js` |

### 5.11 控制面板类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.control-panel` | `.control-panel` | HTML 静态 |
| `.control-group` | `.control-panel__group` | HTML 静态 |
| `.control-buttons` | `.control-panel__actions` | HTML 静态 |
| `.status-group` | `.control-panel__status` | HTML 静态 |
| `.status-item` | `.control-panel__status-item` | HTML 静态 |
| `.status-label` | `.control-panel__status-label` | HTML 静态 |
| `.status-value` | `.control-panel__status-value` | HTML 静态 |
| `.cp-cluster` | `.control-panel__cluster` | HTML 静态 |
| `.cp-status` | `.control-panel__cluster--status` | HTML 静态 |
| `.cp-raw` | `.control-panel__cluster--raw` | HTML 静态 |
| `.cp-bucket` | `.control-panel__cluster--bucket` | HTML 静态 |
| `.cp-answer` | `.control-panel__cluster--answer` | HTML 静态 |
| `.cp-proxy` | `.control-panel__cluster--proxy` | HTML 静态 |

### 5.12 布局类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.sidebar` | `.sidebar` | HTML 静态 |
| `.sidebar-header` | `.sidebar__header` | HTML 静态 |
| `.sidebar-menu` | `.sidebar__menu` | HTML 静态 |
| `.sidebar-footer` | `.sidebar__footer` | HTML 静态 |
| `.menu-item` | `.sidebar__item` | `state.js`, `events.js` |
| `.menu-item.active` | `.sidebar__item.is-active` | `state.js` |
| `.sidebar-mode-btn` | `.sidebar__mode-btn` | `events.js` |
| `.main-container` | `.main` | HTML 静态 |
| `.content-area` | `.main__content` | `events.js` |
| `.left-content` | `.main__left` | HTML 静态 |
| `.right-logs` | `.main__right` | HTML 静态 |
| `.resizer` | `.main__resizer` | `events.js` |
| `.resizer.resizing` | `.main__resizer.is-resizing` | `events.js` |
| `.view-panel` | `.view-panel` | `state.js` |
| `.view-panel.active` | `.view-panel.is-active` | `state.js` |
| `.panel-header` | `.view-panel__header` | HTML 静态 |
| `.header-controls` | `.view-panel__controls` | HTML 静态 |
| `.logs-container` | `.logs-container` | `events.js`, `logs-ui.js` |
| `.logs-main-area` | `.logs-container__main` | HTML 静态 |
| `.traffic-monitor` | `.traffic-monitor` | `logs-ui.js`, `events.js` |
| `.traffic-log` | `.traffic-monitor__log` | HTML 静态 |
| `.request-details` | `.traffic-monitor__details` | HTML 静态 |

### 5.13 简单模式类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `#simple-home` | `.simple-home` | HTML 静态 |
| `.simple-home-bottom` | `.simple-home__footer` | HTML 静态 |
| `.simple-logo-block` | `.simple-home__logo` | HTML 静态 |
| `.simple-logo` | `.simple-home__logo-img` | HTML 静态 |
| `.feature-grid` | `.simple-home__grid` | HTML 静态 |
| `.feature-card` | `.simple-home__card` | `rules-ui.js` |
| `.feature-card--active` | `.simple-home__card.is-active` | `rules-ui.js` |
| `.simple-lead` | `.simple-home__lead` | HTML 静态 |
| `.simple-ruleset-empty` | `.simple-home__empty` | HTML 静态 |
| `.simple-home-footer` | `.simple-home__footer` | HTML 静态 |
| `.simple-link` | `.simple-home__link` | HTML 静态 |
| `.simple-cp-active` | `.simple-home__card.is-active` | `state.js` |

### 5.14 赞赏组件类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.appreciation-wrapper` | `.appreciation` | `app.js` |
| `.appreciation-section` | `.appreciation__section` | `app.js` |
| `.appreciation-icon` | `.appreciation__icon` | `app.js` |
| `.appreciation-text` | `.appreciation__text` | `app.js` |
| `.appreciation-popup` | `.appreciation__popup` | `app.js` |
| `.appreciation-content` | `.appreciation__content` | `app.js` |
| `.appreciation-qr-container` | `.appreciation__qr-group` | `app.js` |
| `.appreciation-qr` | `.appreciation__qr` | `app.js` |
| `.heart-icon` | `.appreciation__icon--heart` | `app.js` |
| `.heart-icon--qq` | `.appreciation__icon--qq` | `app.js` |
| `.qq-group-line` | `.appreciation__qq` | `app.js` |
| `.donation-messages` | `.modal--donation .modal__messages` | `app.js` |
| `.donation-message` | `.modal--donation .modal__message` | `app.js` |

### 5.15 更新面板类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.update-version-info` | `.modal--update .modal__version-info` | `settings-ui.js` |
| `.current-version` | `.modal--update .modal__current-version` | `settings-ui.js` |
| `.new-version` | `.modal--update .modal__new-version` | `settings-ui.js` |
| `.version-label` | `.modal--update .modal__version-label` | `settings-ui.js` |
| `.version-number` | `.modal--update .modal__version-number` | `settings-ui.js` |
| `.update-changelog` | `.modal--update .modal__changelog` | `settings-ui.js` |
| `.changelog-content` | `.modal--update .modal__changelog-content` | `settings-ui.js` |
| `.update-install-message` | `.modal--update .modal__install-message` | `settings-ui.js` |
| `.install-warning` | `.modal--update .modal__warning` | `settings-ui.js` |

### 5.16 教程类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.tutorial-body` | `.modal--tutorial .modal__body` | `tutorial-ui.js` |
| `.tutorial-page` | `.modal--tutorial .modal__page` | `tutorial-ui.js` |
| `.tutorial-greeting` | `.modal--tutorial .modal__greeting` | `tutorial-ui.js` |
| `.tutorial-title` | `.modal--tutorial .modal__title` | `tutorial-ui.js` |
| `.tutorial-desc` | `.modal--tutorial .modal__description` | `tutorial-ui.js` |
| `.tutorial-icon-wrap` | `.modal--tutorial .modal__icon-wrap` | `tutorial-ui.js` |
| `.tutorial-icon-circle` | `.modal--tutorial .modal__icon-circle` | `tutorial-ui.js` |
| `.tutorial-check-icon` | `.modal--tutorial .modal__check-icon` | `tutorial-ui.js` |
| `.tutorial-mode-options` | `.modal--tutorial .modal__mode-options` | `tutorial-ui.js` |
| `.tutorial-mode-card` | `.modal--tutorial .modal__mode-card` | `tutorial-ui.js` |
| `.tutorial-mode-card.selected` | `.modal--tutorial .modal__mode-card.is-selected` | `tutorial-ui.js` |
| `.mode-card-icon` | `.modal--tutorial .modal__mode-card-icon` | `tutorial-ui.js` |
| `.tutorial-finding-status` | `.modal--tutorial .modal__finding-status` | `tutorial-ui.js` |
| `.tutorial-spinner` | `.modal--tutorial .modal__spinner` | `tutorial-ui.js` |
| `.tutorial-cache-path-wrap` | `.modal--tutorial .modal__cache-wrap` | `tutorial-ui.js` |
| `.tutorial-cache-input` | `.modal--tutorial .modal__cache-input` | `tutorial-ui.js` |
| `.tutorial-browse-btn` | `.modal--tutorial .modal__browse-btn` | `tutorial-ui.js` |
| `.tutorial-steps` | `.modal--tutorial .modal__steps` | `tutorial-ui.js` |
| `.tutorial-hint` | `.modal--tutorial .modal__hint` | `tutorial-ui.js` |
| `.tutorial-text-content` | `.modal--tutorial .modal__text` | `tutorial-ui.js` |
| `.tutorial-feature-list` | `.modal--tutorial .modal__features` | `tutorial-ui.js` |
| `.tutorial-note` | `.modal--tutorial .modal__note` | `tutorial-ui.js` |
| `.tutorial-footer` | `.modal--tutorial .modal__footer` | `tutorial-ui.js` |
| `.tutorial-progress` | `.modal--tutorial .modal__progress` | `tutorial-ui.js` |
| `.progress-dot` | `.modal--tutorial .modal__progress-dot` | `tutorial-ui.js` |
| `.progress-dot.active` | `.modal--tutorial .modal__progress-dot.is-active` | `tutorial-ui.js` |
| `.tutorial-actions` | `.modal--tutorial .modal__actions` | `tutorial-ui.js` |

### 5.17 表单类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.form-group` | `.form-group` | `proxy-ui.js` |
| `.form-input` | `.form-input` | `proxy-ui.js`, `community-ui.js` |
| `.form-help-text` | `.form-group__help` | HTML 静态 |

### 5.18 其他类名

| 旧类名 | 新类名 | JS 引用位置 |
|--------|--------|------------|
| `.close-progress-bar` | `.btn__progress-bar` | `proxy-ui.js` |
| `.close-progress-bar.active` | `.btn__progress-bar.is-active` | `proxy-ui.js` |
| `.cache-buttons` | `.log-item__actions` | `settings-ui.js` |
| `.cache-progress-bar` | `.progress-bar` | `settings-ui.js` |
| `.cache-progress-bar.active` | `.progress-bar.is-active` | `settings-ui.js` |
| `.cache-closing` | `.btn__state-closing` | `settings-ui.js` |
| `.cache-done` | `.btn__state-done` | `settings-ui.js` |
| `.copied` | `.btn--copy.is-copied` | `answers-ui.js` |
| `.filter-btn` | `.btn--filter` | `logs-ui.js` |
| `.filter-btn.active` | `.btn--filter.is-active` | `logs-ui.js` |
| `.log-search-bar` | `.logs-container__search` | HTML 静态 |
| `.log-search-input` | `.logs-container__search-input` | HTML 静态 |
| `.log-search-close` | `.logs-container__search-close` | HTML 静态 |
| `.log-search-filters` | `.logs-container__filters` | HTML 静态 |
| `.log-search-status` | `.logs-container__search-status` | HTML 静态 |
| `.upload-progress` | `.upload-progress` | `community-ui.js` |
| `.progress-bar` | `.upload-progress__bar` | `community-ui.js` |
| `.progress-fill` | `.upload-progress__fill` | `community-ui.js` |
| `.progress-text` | `.upload-progress__text` | `community-ui.js` |
| `.copy-toast` | `.toast` | `answers-ui.js` |
| `.copy-toast.success` | `.toast--success` | `answers-ui.js` |
| `.copy-toast.error` | `.toast--error` | `answers-ui.js` |
| `.highlight` | `.text--highlight` | `settings-ui.js` |

---

## 六、JS 文件修改清单

### 6.1 需要修改的 JS 文件

| 文件 | 修改类型 | 预计修改行数 |
|------|----------|------------|
| `renderer/answers-ui.js` | 更新 `innerHTML` 模板类名、`classList` 操作 | ~60 处 |
| `renderer/rules-ui.js` | 更新 `innerHTML` 模板类名、`className` 替换 | ~50 处 |
| `renderer/community-ui.js` | 更新 `innerHTML` 模板类名 | ~40 处 |
| `renderer/proxy-ui.js` | 更新动态模态框模板、`className` 替换、`classList` 操作 | ~30 处 |
| `renderer/settings-ui.js` | 更新动态模态框模板、`classList` 操作 | ~40 处 |
| `renderer/app.js` | 更新赞赏弹窗模板、按钮 `className` 替换 | ~30 处 |
| `renderer/state.js` | 更新选择器（`.menu-item.active` -> `.sidebar__item.is-active` 等） | ~10 处 |
| `renderer/events.js` | 更新选择器（`.menu-item` -> `.sidebar__item` 等） | ~15 处 |
| `renderer/logs-ui.js` | 更新 `classList` 操作、选择器 | ~20 处 |
| `renderer/tutorial-ui.js` | 更新选择器（`.tutorial-mode-card` -> `.modal--tutorial .modal__mode-card` 等） | ~15 处 |

### 6.2 无需修改的 JS 文件

- `renderer/utils.js` — 纯工具函数，不涉及 DOM 操作
- `renderer/file-ui.js` — 不涉及 DOM 类操作

---

## 七、HTML 结构调整计划

### 7.1 赞赏组件模板化

**当前问题**：同一段赞赏 HTML 在 `#simple-home` 和 `#settings-view` 中各出现一次。

**改进方案**：使用 `<template>` 标签定义一次，通过 JS 在需要的地方渲染。

```html
<!-- 定义模板（在 index.html 中仅出现一次，放在 body 末尾） -->
<template id="appreciation-template">
    <div class="appreciation">
        <!-- 赞赏内容 -->
    </div>
</template>
```

**JS 渲染**（在 `renderer/app.js` 的 `init()` 中）：

```javascript
function renderAppreciation(targetSelector) {
    const template = document.getElementById('appreciation-template');
    const target = document.querySelector(targetSelector);
    if (template && target && !target.querySelector('.appreciation')) {
        target.appendChild(template.content.cloneNode(true));
    }
}

// 在 DOMContentLoaded 后执行
renderAppreciation('#simple-home .simple-home__footer');
renderAppreciation('#settings-view');
```

### 7.2 模态框 HTML 结构统一

**统一后的标准结构**：

```html
<div class="modal" id="xxxModal" style="display: none;">
    <div class="modal__content">
        <div class="modal__header">
            <h3>标题</h3>
            <button class="modal__close"><i class="bi bi-x"></i></button>
        </div>
        <div class="modal__body">
            <!-- 内容 -->
        </div>
        <div class="modal__footer">
            <button class="btn btn--ghost">取消</button>
            <button class="btn btn--primary">确认</button>
        </div>
    </div>
</div>
```

**需要调整的模态框**：
- `#ruleGroupModal`
- `#ruleModal`
- `#rulesetDetailModal`
- `#uploadRulesetModal`
- `#tutorialModal`
- `#portChangeModal`（动态生成）

### 7.3 按钮 HTML 结构统一

**统一后的标准结构**：

```html
<!-- 带图标按钮 -->
<button class="btn btn--primary" id="toggleProxyBtn">
    <i class="bi bi-play-circle"></i>
    <span>启动代理</span>
</button>

<!-- 仅图标按钮 -->
<button class="btn btn--icon btn--ghost" id="clearAnswersBtn" title="清空答案">
    <i class="bi bi-trash"></i>
</button>

<!-- 小尺寸按钮 -->
<button class="btn btn--sm btn--ghost" id="sortByFile">
    <i class="bi bi-file-earmark"></i>
</button>
```

---

## 八、Phase 详细实施计划

### Phase 1：扩展 Design Tokens

**文件**：`styles/tokens.css`

**目标**：将 tokens.css 从 30 行扩展为完整的设计系统，覆盖所有硬编码值。

```css
:root {
    /* ===== 主色系 ===== */
    --color-primary-50:  #e3f2fd;
    --color-primary-100: #bbdefb;
    --color-primary-200: #90caf9;
    --color-primary-500: #007bff;
    --color-primary-600: #0056b3;
    --color-primary-700: #004494;

    /* ===== 危险色系 ===== */
    --color-danger-50:  #fde8ea;
    --color-danger-100: #f8d7da;
    --color-danger-500: #dc3545;
    --color-danger-600: #c82333;
    --color-danger-700: #a71e2a;

    /* ===== 成功色系 ===== */
    --color-success-50:  #d4edda;
    --color-success-500: #28a745;
    --color-success-600: #218838;
    --color-success-700: #155724;

    /* ===== 警告色系 ===== */
    --color-warn-50:  #fff3cd;
    --color-warn-500: #ffc107;
    --color-warn-700: #856404;

    /* ===== 信息色系 ===== */
    --color-info-500: #17a2b8;
    --color-info-600: #138496;
    --color-info-100: #bbdefb;

    /* ===== 灰色系 ===== */
    --color-gray-50:  #f8f9fa;
    --color-gray-100: #e9ecef;
    --color-gray-200: #dee2e6;
    --color-gray-300: #ced4da;
    --color-gray-400: #adb5bd;
    --color-gray-500: #6c757d;
    --color-gray-600: #495057;
    --color-gray-700: #333333;
    --color-gray-800: #212529;
    --color-white:    #ffffff;

    /* ===== 语义化别名 ===== */
    --color-bg-page:    var(--color-white);
    --color-bg-muted:   var(--color-gray-50);
    --color-bg-panel:   var(--color-white);
    --color-border:     var(--color-gray-100);
    --color-border-strong: var(--color-gray-200);
    --color-text:       var(--color-gray-700);
    --color-text-muted: var(--color-gray-500);
    --color-text-heading: var(--color-gray-600);
    --color-primary:    var(--color-primary-500);
    --color-primary-hover: var(--color-primary-600);
    --color-danger:     var(--color-danger-500);
    --color-danger-hover: var(--color-danger-600);
    --color-success-bg: var(--color-success-50);
    --color-success-text: var(--color-success-700);
    --color-error-bg:   var(--color-danger-100);
    --color-error-text: var(--color-danger-700);
    --color-warn-bg:    var(--color-warn-50);
    --color-warn-text:  var(--color-warn-700);

    /* ===== 间距系统 ===== */
    --space-2xs: 2px;
    --space-xs:  4px;
    --space-sm:  8px;
    --space-md:  12px;
    --space-lg:  16px;
    --space-xl:  20px;
    --space-2xl: 24px;
    --space-3xl: 32px;
    --space-4xl: 40px;

    /* ===== 圆角系统 ===== */
    --radius-xs:   3px;
    --radius-sm:   4px;
    --radius-md:   6px;
    --radius-lg:   8px;
    --radius-xl:   12px;
    --radius-2xl:  24px;
    --radius-full: 9999px;

    /* ===== 字体系统 ===== */
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --font-mono: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', monospace;
    --text-xs:   10px;
    --text-sm:   12px;
    --text-base: 13px;
    --text-lg:   14px;
    --text-xl:   16px;
    --text-2xl:  18px;
    --text-3xl:  20px;
    --text-4xl:  22px;
    --text-5xl:  50px;
    --leading-normal: 1.4;
    --leading-relaxed: 1.5;
    --leading-loose: 1.6;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;

    /* ===== 阴影系统 ===== */
    --shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md:  0 2px 10px rgba(0, 0, 0, 0.08);
    --shadow-lg:  0 4px 20px rgba(0, 0, 0, 0.12);
    --shadow-xl:  0 8px 32px rgba(0, 0, 0, 0.2);
    --shadow-2xl: 0 20px 60px rgba(0, 0, 0, 0.2);

    /* ===== 动画系统 ===== */
    --ease-fast:   0.15s ease;
    --ease-normal: 0.2s ease;
    --ease-slow:   0.3s ease;
    --ease-out:    cubic-bezier(0.22, 1, 0.36, 1);

    /* ===== z-index 层级系统 ===== */
    --z-dropdown:    100;
    --z-sticky:      200;
    --z-overlay:     300;
    --z-modal:       400;
    --z-toast:       500;
    --z-titlebar:    1000;
    --z-tooltip:     1100;

    /* ===== 布局尺寸系统 ===== */
    --titlebar-height:   36px;
    --sidebar-width-collapsed: 60px;
    --sidebar-width-expanded:  200px;
    --sidebar-item-height:     48px;
    --panel-header-height:     45px;
    --resizer-width:       4px;
}
```

### Phase 2：拆分可复用组件

**目标**：从 `ui.css` 中提取所有可复用组件，合并重复定义，使用新类名。

**组件文件列表**：
- `components/buttons.css` — 按钮系统
- `components/modals.css` — 模态框系统
- `components/forms.css` — 表单元素
- `components/toggles.css` — 开关组件
- `components/cards.css` — 卡片容器
- `components/badges.css` — 状态徽章
- `components/toast.css` — 提示浮层

### Phase 3：拆分功能区域样式

**目标**：按功能区域拆分样式文件，每个文件对应一个视图/功能模块。

**文件列表**：
- `features/control-panel.css` — 控制面板
- `features/answers.css` — 答案获取视图
- `features/rules.css` — 规则管理视图
- `features/community.css` — 社区规则集视图
- `features/settings.css` — 设置视图
- `features/logs.css` — 日志监听区域
- `features/simple-mode.css` — Simple 模式专属覆盖

### Phase 4：拆分页面级视图样式

**目标**：将页面级专属样式独立出来。

**文件列表**：
- `views/simple-home.css` — 简易首页
- `views/appreciation.css` — 赞赏组件（统一一处）
- `views/tutorial.css` — 新手教程

### Phase 5：布局文件重构

**目标**：从 `base.css` 拆分出布局样式。

**文件列表**：
- `layout.css` — 页面布局（从 base.css 拆分）
- `base.css` — 全局基础样式（精简）

### Phase 6：JS 类名更新

**目标**：同步更新所有 JS 文件中的类名引用。

**实施顺序**：
1. `renderer/answers-ui.js` — 更新模板和 classList 操作
2. `renderer/rules-ui.js` — 更新模板和 className 替换
3. `renderer/community-ui.js` — 更新模板
4. `renderer/proxy-ui.js` — 更新动态模态框和 className 替换
5. `renderer/settings-ui.js` — 更新动态模态框和 classList 操作
6. `renderer/app.js` — 更新赞赏弹窗和按钮 className
7. `renderer/state.js` — 更新选择器
8. `renderer/events.js` — 更新选择器
9. `renderer/logs-ui.js` — 更新 classList 操作和选择器
10. `renderer/tutorial-ui.js` — 更新选择器

### Phase 7：HTML 结构调整

**目标**：统一 HTML 结构，实现组件模板化。

**实施内容**：
- 赞赏组件模板化
- 模态框 HTML 结构统一
- 按钮 HTML 结构统一

### Phase 8：app.css 更新

**目标**：更新 `styles/app.css` 的 `@import` 列表。

```css
@import "./tokens.css";
@import "./base.css";
@import "./titlebar.css";
@import "./layout.css";

/* 可复用组件 */
@import "./components/buttons.css";
@import "./components/modals.css";
@import "./components/forms.css";
@import "./components/toggles.css";
@import "./components/cards.css";
@import "./components/badges.css";
@import "./components/toast.css";

/* 功能区域 */
@import "./features/control-panel.css";
@import "./features/answers.css";
@import "./features/rules.css";
@import "./features/community.css";
@import "./features/settings.css";
@import "./features/logs.css";
@import "./features/simple-mode.css";

/* 页面视图 */
@import "./views/simple-home.css";
@import "./views/appreciation.css";
@import "./views/tutorial.css";
```

---

## 九、实施步骤与依赖关系

```
Step 1: 提取完整类名清单
    │ 从 ui.css 中提取所有类名 → checklist.md
    │ 从 base.css 中提取所有类名 → 追加到 checklist.md
    │ 从 titlebar.css 中提取所有类名 → 追加到 checklist.md
    │
    ▼
Step 2: 提取 JS 引用清单
    │ 扫描所有 renderer/*.js → js-class-usage.md
    │
    ▼
Step 3: 交叉验证
    │ 比对 checklist.md 和 js-class-usage.md
    │ 标记冲突项（JS 引用但 CSS 未定义的类名）
    │
    ▼
Phase 1 (tokens.css)
    │ 扩展设计令牌系统
    ▼
Phase 2 (components/*)
    │ 拆分可复用组件，合并重复定义，使用新类名
    │ 每完成一个文件运行验证脚本
    ▼
Phase 3 (features/*)
    │ 按功能拆分样式文件，使用新类名
    │ 每完成一个文件运行验证脚本
    ▼
Phase 4 (views/*)
    │ 页面级拆分，使用新类名
    │ 每完成一个文件运行验证脚本
    ▼
Phase 5 (layout.css + base.css)
    │ 布局重构，使用新类名
    ▼
Phase 6 (JS 类名更新)
    │ 同步更新所有 JS 文件中的类名引用
    │ 按照 6.1 中的顺序逐一修改
    │ 每完成一个文件运行验证脚本
    ▼
Phase 7 (HTML 结构调整)
    │ 模板化赞赏组件
    │ 统一模态框 HTML 结构
    │ 统一按钮 HTML 结构
    ▼
Phase 8 (app.css 更新)
    │ 更新 @import 列表
    │ 验证所有旧类名已完全移除
    │
    ▼
最终验证
    │ 运行 check-old-classes.ps1
    │ 运行 verify-new-classes.ps1
    │ 启动应用，手动测试所有功能
    │ 确认 checklist.md 中所有项状态为"已验证"
```

---

## 十、风险与注意事项

| 风险项 | 缓解措施 |
|--------|----------|
| 拆分过程中样式丢失 | 每完成一个 Phase 后立即在浏览器中验证 |
| JS 类名遗漏 | 通过第五章映射表逐一核对 + 自动化验证脚本 |
| 选择器特异性变化导致样式不生效 | 保持选择器特异性不超过原值 |
| Simple 模式行为改变 | 逐一对比重构前后的 Simple 模式效果 |
| 赞赏组件 JS 渲染时机问题 | 在 DOMContentLoaded 后执行渲染 |
| `className` 全量替换导致遗漏 | 严格按照映射表修改，修改后全局搜索旧类名确认 |
| AI 遗漏组件 | 使用完整类名提取清单 + 交叉验证 + 自动化脚本三重保障 |

---

## 十一、预期效果

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| 样式文件总数 | 4 个 | 18 个 |
| 最大单文件行数 | ~4530 行（ui.css） | ~400 行（最大组件文件） |
| 重复定义数量 | ~15 处 | 0 处 |
| Design Tokens 覆盖率 | <5% | >90% |
| 硬编码颜色值 | ~300+ 处 | ~20 处（仅 tokens 定义） |
| 选择器最大特异性深度 | 7 层 | 3 层 |
| 代码整洁度 | 混乱（多种命名风格混用） | 统一（BEM 风格） |
| 新增组件所需时间 | 在 4500 行中寻找合适位置 | 直接在对应组件文件添加 |
| 历史包袱 | 大量重复和别名 | 零冗余，全面刷新 |
| 组件遗漏风险 | 高（依赖人工检查） | 低（自动化验证保障） |

---

## 十二、命名规范

重构后统一采用以下命名规范：

### 12.1 组件命名（BEM 风格）

```
.component           /* 块 */
.component__element  /* 元素 */
.component--modifier /* 修饰符 */
```

### 12.2 状态类命名

```
.is-active           /* 交互状态 */
.is-disabled         /* 禁用状态 */
.is-hidden           /* 隐藏状态 */
.is-installed        /* 已安装状态 */
.is-selected         /* 已选中状态 */
.is-closing          /* 关闭中状态 */
.is-restart          /* 重启状态 */
.is-copied           /* 已复制状态 */
.is-resizing         /* 调整中状态 */
.is-done             /* 完成状态 */
```

### 12.3 工具类命名

```
.text--muted         /* 语义化前缀 */
.text--highlight     /* 高亮文字 */
.stack               /* 布局工具 */
.stack--row          /* 变体 */
```

### 12.4 修饰符类命名

```
.component--modifier /* 组件变体 */
--sm                 /* 小尺寸 */
--lg                 /* 大尺寸 */
--primary            /* 主要 */
--ghost              /* 幽灵 */
--danger             /* 危险 */
--success            /* 成功 */
```

---

## 十三、测试验证清单

重构完成后，需要逐一验证以下功能：

### 13.1 功能验证

- [ ] 代理启动/停止按钮样式和状态切换
- [ ] 天学网按钮单击/长按/关闭倒计时/重启状态
- [ ] 答案显示、排序切换、复制、分享、导出
- [ ] 分享结果弹窗（URL 复制、打开链接）
- [ ] 规则集添加/编辑/删除/启用禁用
- [ ] 规则添加/编辑/删除/启用禁用/重置触发次数
- [ ] 规则类型切换时字段显示/隐藏
- [ ] 社区规则集搜索、分页、安装、查看详情
- [ ] 上传规则集进度条
- [ ] 日志搜索、过滤、点击查看详情、清空
- [ ] 日志详情面板下载响应文件
- [ ] 缓存清理确认/长按仅清理/进度条动画
- [ ] 更新通知/更新面板/下载进度/安装确认
- [ ] 新手教程流程
- [ ] 侧边栏切换视图
- [ ] 窗口置顶按钮
- [ ] 简单模式首页/规则集列表/进入应用
- [ ] 控制面板状态同步
- [ ] 赞赏弹窗（启动 5 次后弹出）
- [ ] Simple 模式下所有样式覆盖

### 13.2 样式验证

- [ ] 按钮 hover 效果
- [ ] 模态框动画
- [ ] Toast 提示动画
- [ ] 卡片 hover 阴影
- [ ] 开关滑块动画
- [ ] 徽章颜色和圆角
- [ ] 表单输入 focus 状态
- [ ] 滚动条样式
- [ ] 响应式布局（窗口缩放）
- [ ] 旧类名已完全移除（全局搜索确认）
- [ ] 自动化验证脚本通过（check-old-classes.ps1）
- [ ] 自动化验证脚本通过（verify-new-classes.ps1）
- [ ] checklist.md 中所有项状态为"已验证"
