# Auto366 项目架构规则

## 项目概述
Auto366 是一个基于 Electron 的 HTTP 代理拦截工具，用于捕获和修改网络请求/响应数据。

## 架构设计原则

### 模块化设计
- **main.js 只负责初始化和模块协调**，不应承担具体业务逻辑
- 每个模块负责自己的功能领域和 IPC 处理器注册
- 模块之间通过实例化和方法调用通信，不直接依赖 IPC

## 目录结构

```
Auto366/
├── main.js                 # 应用入口，只负责初始化和模块协调
├── preload.js              # Electron preload 脚本，暴露 API 给渲染进程
├── index.html              # 主页面
├── modules/                # 核心业务模块
│   ├── window.js           # 窗口管理（创建、大小、置顶、IPC）
│   ├── proxy.js            # 代理服务器（HTTP拦截、规则、文件操作、IPC）
│   ├── cert.js             # 证书管理（使用 http-mitm-proxy 生成的证书）
│   ├── answer.js           # 答案提取逻辑
│   ├── rules.js            # 规则管理（请求规则）
│   ├── rules-loader.js     # 规则加载器
│   ├── update.js           # 更新管理
│   └── file.js             # 文件操作
├── renderer/               # 渲染进程代码
│   ├── app.js              # 应用主逻辑
│   ├── events.js           # 事件绑定
│   ├── state.js            # 状态管理
│   ├── utils.js            # 工具函数
│   ├── proxy-ui.js         # 代理界面
│   ├── rules-ui.js         # 规则界面
│   ├── answers-ui.js       # 答案界面
│   ├── community-ui.js     # 社区界面
│   ├── logs-ui.js          # 日志界面
│   └── settings-ui.js      # 设置界面
├── components/             # UI 组件
│   ├── toast.js            # 提示组件
│   ├── modal.js            # 模态框组件
│   └── confirm.js          # 确认框组件
├── styles/                 # 样式文件
└── resources/              # 静态资源
```

## 核心模块职责

### main.js
- 应用生命周期管理（app.whenReady、window-all-closed）
- 模块实例化和协调
- autoUpdater 配置和事件监听
- 内置规则集导入
- 文件/目录选择对话框
- **不应包含**：窗口控制、代理控制、规则管理等业务逻辑

### modules/window.js (WindowManager)
- 窗口创建和配置
- UI 模式读取和切换（simple/professional）
- 窗口大小控制（simple: 875x1010, professional: 1400x900）
- 窗口操作（最小化、最大化、关闭、置顶）
- **注册所有窗口相关的 IPC 处理器**
- 通过 `registerIpcHandlers()` 方法注册 IPC

### modules/proxy.js (ProxyServer)
- HTTP 代理服务器（使用 http-mitm-proxy）
- 请求/响应拦截和修改
- 规则管理（响应规则的增删改查、导入导出）
- 答案捕获和提取
- 文件操作（清理缓存、导入ZIP、下载文件、分享答案）
- 注入包管理（下载、保存、MD5校验）
- **注册所有代理、规则、文件操作相关的 IPC 处理器**
- 通过 `registerIpcHandlers(dialog, mainWindow, supabase, SUPABASE_BUCKET, uuidv4, fs, path, os, require)` 方法注册 IPC

### modules/cert.js (CertificateManager)
- 证书路径管理
- 使用 http-mitm-proxy 生成的证书（位于 `~/.http-mitm-proxy/certs/`）
- **不自己生成证书**

### modules/answer.js (AnswerExtractor)
- 答案提取逻辑
- 支持多种题型：听后选择、听后回答、听后转述、朗读短文
- 支持多种数据格式：JSON、XML、JavaScript、纯文本

### preload.js
- 使用 `contextBridge.exposeInMainWorld` 暴露 API
- 窗口操作：`windowMinimize`、`windowClose` 使用 `ipcRenderer.send()`（非 invoke）
- 其他 API 使用 `ipcRenderer.invoke()`

## IPC 通信规范

### 命名约定
- 获取类：`get-*`（如 `get-rules`、`get-proxy-port`）
- 设置类：`set-*`（如 `set-proxy-port`、`set-answer-capture-enabled`）
- 操作类：动词开头（如 `start-answer-proxy`、`stop-answer-proxy`）
- 窗口类：`window-*`（如 `window-minimize`、`window-close`）

### 通信方式
- **异步返回结果**：使用 `ipcMain.handle()` + `ipcRenderer.invoke()`
- **单向通知**：使用 `ipcMain.on()` + `ipcRenderer.send()`
- **窗口最小化和关闭**：必须使用 `send/on` 模式（非 invoke/handle）

### 模块 IPC 注册
- 每个模块通过 `registerIpcHandlers()` 方法注册自己的 IPC 处理器
- main.js 中调用各模块的注册方法
- **不要**在 main.js 中直接写业务模块的 IPC 处理器

## 代码规范

### 导入规范
- 使用 `require()` 导入模块（CommonJS）
- 渲染进程使用 ES 模块（`import/export`）
- preload.js 使用 CommonJS

### 错误处理
- 所有 IPC 处理器必须有 try-catch 错误处理
- 返回统一格式：`{ success: boolean, error?: string, data?: any }`
- 全局错误处理：`process.on('uncaughtException')` 和 `process.on('unhandledRejection')`

### 路径处理
- 使用 `path.join()` 拼接路径
- 开发环境和生产环境的路径处理要区分
- 静态资源使用 `./resources/xxx` 相对路径

### 证书管理
- 必须使用 http-mitm-proxy 生成的证书
- 证书路径：`~/.http-mitm-proxy/certs/`
- **不要自己生成证书**

## UI 模式

### Simple 模式
- 窗口大小：875x1010
- 适用于基础功能

### Professional 模式
- 窗口大小：1400x900
- 适用于高级功能

## 规则系统

### 规则类型
- request：请求规则
- response：响应规则
- response-headers：响应头规则
- zip-implant：ZIP 植入规则
- inject：注入规则

### 规则组
- 规则可以分组（`isGroup: true`）
- 支持内置规则集（`isBuiltin: true`）
- 支持社区规则集（`communityRulesetId`）

### 内置规则集
- 位于 `rulesets/` 目录
- 每个规则集包含 `ruleset.json`（元信息）和 `{name}.json`（规则数据）
- 启动时自动导入

## 更新管理

- 使用 electron-updater
- GitHub Releases 作为更新源
- 配置：`provider: 'github', owner: 'cyrilguocode', repo: 'Auto366'`
- 启动时自动检查更新（可配置）

## Supabase 集成

- 用于答案文件分享
- Bucket：`auto366-share`
- 上传格式：JSON
- 文件名格式：`{timestamp}_{randomId}.{extension}`

## 注意事项

1. **main.js 不应超过 350 行**，业务逻辑必须放到模块中
2. **每个模块负责自己的 IPC 处理器注册**
3. **使用 http-mitm-proxy 的证书，不要自己生成**
4. **窗口最小化和关闭必须使用 send/on 模式**
5. **所有 IPC 处理器必须有错误处理**
6. **规则导入时处理重复规则和规则组替换**
7. **开发环境和生产环境的路径处理要区分**
