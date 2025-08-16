
<div align=center><img src="icon_black.png"></div>

# Auto366

天学网自动化答题工具！解放双手，提高学习效率！

## 项目简介

Auto366 是一个专为天学网设计的自动化答题工具，支持多种题型自动填写，辅助工具有听力答案提取和等待音频替换。通过智能检测下载的练习文件，自动提取答案并完成填写，让您专注于学习而不是重复性操作。

## TODOS

1. 用户输入当前缩放率，自动处理位置偏差 (✔)
2. 区域坐标记忆(LocalStorage) (预计明天做)
3. 使用argostranslate翻译(提升速度与准确率) (即将取消)
4. 听力答案获取，加入删除文件 (✔)
5. 增加设置选项，可控制存档路径更改和模拟音频开关 (暂时不考虑)
6. 单词pk截图缩放调整 (预计明天做)
7. 加入万能答案获取 (即将完成)

## 安装说明

### 方法一：直接下载（推荐）

1. 从 [Releases](https://github.com/cyrilguocode/Auto366/releases) 页面下载最新版本安装包
2. 点击安装
3. 安装后双击运行 `Auto366.exe`
4. 安装完成后打开工具会有更详细的教程

### 方法二：源码编译

```bash
# 克隆项目
git clone https://github.com/cyrilguocode/Auto366.git
cd Auto366

# 安装依赖
npm install

# 运行开发版本
npm start

# 打包应用
npm run build
```

## 配置说明

### 资源路径

windows默认资源路径：`D:/Up366StudentFiles/resources/`

如需修改，请编辑 `preload.js` 文件中的 `resourcePath` 变量。

### 快捷键

- `Ctrl+Shift+Q` - 终止填充（数据会保留）

- `Ctrl+F12` - 打开开发者工具

## 许可证

本项目采用 GNU General Public License v3.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

---

**免责声明**：本工具仅供学习和研究使用，使用者需自行承担使用风险，开发者不承担任何法律责任。
