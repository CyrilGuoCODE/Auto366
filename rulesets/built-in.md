# Auto366 内置规则集

此文件夹包含 Auto366 的内置规则集，程序启动时会自动导入这些规则集。

## 文件结构说明

每个子文件夹代表一个独立的规则集，包含以下文件：

| 文件 | 说明 |
|------|------|
| `ruleset.json` | 规则集元信息（名称、描述、兼容性、版本号） |
| `<文件夹名>.json` | 规则定义（规则类型、URL 匹配、动作配置） |
| `<文件夹名>.js` | 动态注入脚本（仅 `zip-implant-dynamic` 类型规则需要） |
| `<文件夹名>.zip` | 注入 ZIP 包（仅 `zip-implant` 类型规则需要） |
| 其他文件 | 辅助实现规则集功能的文件 |

## ruleset.json 格式

```json
{
  "name": "规则集名称",
  "description": "规则集描述",
  "compatible": false,
  "version": 1
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 规则集名称，必须以"内置-"开头 |
| `description` | string | 规则集描述 |
| `compatible` | boolean | 是否与其他不兼容规则集兼容（含注入规则的应为 `false`） |
| `version` | integer | 版本号，更新规则内容时递增此值以触发自动更新 |

## 版本更新机制

程序每次启动时会比较内置文件夹与本地存储的 `version`：

| 本地状态 | 内置 version | 行为 |
|----------|-------------|------|
| 不存在 | 任意 | 新增导入 |
| 存在但无 `version` 字段 | 任意 | 重新导入（视为 `version = 0`） |
| `version` < 内置 `version` | 更大 | 重新导入（更新） |
| `version` >= 内置 `version` | 相等或更小 | 跳过 |

更新时会保留用户设置的 `enabled` 状态和 `createdAt` 时间戳。

## 开发说明

如需添加新的内置规则集：

1. 在 `rulesets/` 下创建新文件夹
2. 添加 `ruleset.json`（含 `name`、`description`、`compatible`、`version`）
3. 添加 `<文件夹名>.json` 规则定义文件
4. 添加辅助实现文件（ZIP 包、JS 脚本等）

如需更新现有规则集：

1. 修改规则定义文件（`.json`）或辅助文件
2. 将 `ruleset.json` 中的 `version` 值加 1
3. 用户下次启动应用时自动检测并更新
