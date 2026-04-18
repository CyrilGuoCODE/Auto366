# Auto366 Electron 项目重构计划

---

## 目标结构

```
根目录/
├── package.json
├── main.js              (入口，仅import模块)
├── preload.js          (精简)
├── index.html          (基本不变)
├── icon.png            (应用图标)
│
├── styles/             (CSS样式)
│
├── modules/           (主进程JS模块 - 8个)
│   ├── window.js
│   ├── proxy.js
│   ├── cert.js
│   ├── rules.js
│   ├── rules-loader.js
│   ├── answer.js
│   ├── update.js
│   └── file.js
│
├── resources/         (静态资源)
│   └── 已经好了
│
├── components/        (UI组件类)
│
└── renderer/         (渲染进程JS模块 - 10个)
    ├── app.js
    ├── events.js
    ├── state.js
    ├── proxy-ui.js
    ├── answers-ui.js
    ├── rules-ui.js
    ├── community-ui.js
    ├── settings-ui.js
    ├── logs-ui.js
    └── utils.js
```

---

## 主进程模块 (modules/ 8个)

| 模块 | 行数 | 内容 |
|------|------|------|
| window.js | ~150 | 窗口创建/销毁、最大化、置顶、UI模式切换、缩放因子 |
| proxy.js | ~350 | 代理服务器启动/停止、端口管理、流量拦截、本地HTTP服务 |
| cert.js | ~230 | 证书导入、检查(保持原样) |
| rules.js | ~250 | 规则匹配、CRUD操作、导入/导出 |
| rules-loader.js | ~80 | 内置规则集加载(独立，方便扩展新规则) |
| answer.js | ~700 | ZIP解压、答案提取、解析(保持原样) |
| update.js | ~80 | 检查更新、下载更新、安装更新 |
| file.js | ~180 | 文件对话框、上传下载、Supabase分享 |

---

## 组件设计 (components/ 4个)

保留高频复用组件而且需要动态生成：
例子：
| 组件 | 用途 |
|------|------|
| modal.js | 通用模态框类，5个模态框可复用 |
| confirm.js | 确认对话框类 |
| toast.js | 提示消息类，日志/提示多处调用 |

**设计思路**（用类而非 Web Components）：

```javascript
// modal.js
class Modal {
  static show(options)     // { title, content, buttons }
  static alert(message)    // 单按钮提示
  static confirm(message, onConfirm)  // 确定/取消
}

// toast.js
class Toast {
  static success(message)
  static error(message)
  static info(message)
}
```

---

## 渲染进程模块 (renderer/ 10个)

| 模块 | 行数 | 内容 |
|------|------|------|
| app.js | ~50 | 应用入口初始化、同步UI模式 |
| events.js | ~200 | 公共事件绑定、菜单切换 |
| state.js | ~100 | 状态管理、视图切换 |
| proxy-ui.js | ~300 | 代理控制UI、端口修改 |
| answers-ui.js | ~600 | 答案列表、排序筛选 |
| rules-ui.js | ~500 | 规则管理、添加/编辑 |
| community-ui.js | ~700 | 社区规则、搜索下载 |
| settings-ui.js | ~400 | 设置UI、模式切换 |
| logs-ui.js | ~400 | 日志显示、详情查看 |
| utils.js | ~100 | 工具函数 |

---

## Styles 重构方案

**当前结构** (6个文件):
```
styles/
├── app.css         # 主入口，import 其他5个文件
├── tokens.css     # CSS变量 (~30行，含 simple 模式覆盖)
├── ui.css         # 按钮/卡片等 (~85行)
├── components.css # 所有组件样式 (~3900行)
├── titlebar.css   # 标题栏
└── simple.css    # simple 模式显示逻辑 (~667行)
```

**目标结构** (5个文件):
```
styles/
├── app.css         # 主入口，import 其他4个
├── tokens.css      # CSS变量 (保持)
├── base.css        # 基础样式: body, *, 侧边栏, 布局等 (从 components.css 抽取)
├── ui.css          # 通用组件: 按钮, 输入框, 卡片 (保持 + 简化)，以及各种HTML标签(风格是蓝白简约不要渐变)
└── titlebar.css    # 标题栏 (保持)
```

**重构内容**:

1. **app.css** - 调整 import 顺序

2. **tokens.css** - 保持不变
   - CSS 变量（颜色、圆角、阴影等）
   - `html[data-ui="simple"]` 模式变量覆盖

3. **base.css** - 新建，从 components.css 抽取：
   - `body` 样式
   - 侧边栏 `.sidebar` 样式
   - 布局 `.content-area`, `.left-content`, `.right-logs` 等
   - 通用类 `.flex`, `.hidden` 等

4. **ui.css** - 保持/简化：
   - 按钮 `.btn` 系列
   - 卡片 `.card`
   - 工具类 `.stack`
   - 表单元素基础样式

5. **titlebar.css** - 保持不变

6. **移除**:
   - `simple.css` - 模式显示逻辑分散到 base.css/ui.css 的选择器中

**说明**：
- 通过 `html[data-ui="simple"]` 选择器处理两种模式（已有）
- UI 切换逻辑保持在 JS（renderer's switchView）中

---

## 实施注意事项

1. **不改变任何功能** - 仅重构代码结构
2. **不改变任何UI** - 保持现有界面完全一致
3. **渐进式重构** - 可分步实施
4. **UI组件化** - 仅抽取高频使用需要动态生成的UI逻辑为类

---

## 实施顺序

1. **Styles 重构** - 创建 base.css，调整 import，移除 simple.css
2. **Renderer 拆分** - 拆分 renderer.js → renderer/ (10个)
3. **Main 拆分** - 拆分 main.js和answer-proxyjs和其他核心业务js → modules/ (8个)
4. **UI组件类实现** - 实现UI组件类简化部分高频使用需要动态生成的UI

---