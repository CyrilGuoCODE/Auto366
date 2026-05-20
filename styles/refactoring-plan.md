# Auto366 样式架构重构方案

## 核心思想

**分层架构**：按职责分层，每层只处理自己的范围

```
global/     → 全局基础（tokens、base、layout、titlebar、simple-home）
components/ → 可复用组件（buttons、modals、forms、toggles）
features/   → 功能模块（仅作用于各自容器内部）
overlay/    → 浮窗/弹窗/覆盖层
```

## 目录结构

```
styles/
├── app.css              # 唯一入口
├── ui.css               # 原始样式（保留参考）
├── global/              # 全局基础样式
│   ├── tokens.css       # Design Tokens
│   ├── base.css         # 全局基础
│   ├── layout.css       # 布局系统
│   ├── titlebar.css     # 标题栏
│   └── simple-home.css  # 简易首页
├── components/          # 可复用组件
│   ├── buttons.css      # 按钮系统
│   ├── modals.css       # 模态框基础
│   ├── forms.css        # 表单组件
│   └── toggles.css      # 开关组件
├── features/            # 功能模块（仅容器内部）
│   ├── control-panel.css
│   ├── answers.css
│   ├── rules.css
│   ├── community.css
│   ├── settings.css
│   ├── logs.css
│   └── simple-mode.css
└── overlay/             # 浮窗/弹窗/覆盖层
    ├── appreciation.css
    └── tutorial.css
```

## 分层原则

| 目录 | 职责 | 特点 |
|------|------|------|
| `global/` | 全局基础样式 | 影响整个应用，无作用域限制 |
| `components/` | 可复用组件 | 纯组件，不依赖特定功能上下文 |
| `features/` | 功能模块样式 | **仅作用于各自容器内部**，继承全局基础 |
| `overlay/` | 浮窗/弹窗 | 覆盖在其他内容之上的独立层 |

## 命名规范

- **BEM 风格**：`.block__element--modifier`
- **状态类**：`.is-active`、`.is-disabled`、`.is-hidden`
- **工具类**：`.text--muted`、`.text--highlight`

## 重构目标

1. **模块化**：单文件职责单一
2. **无重复**：组件只定义一次
3. **Design Tokens 全覆盖**：硬编码值 → CSS 变量
4. **零历史包袱**：全面换新，不兼容旧类名
