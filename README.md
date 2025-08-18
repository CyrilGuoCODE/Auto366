
<div align=center><img src="icon_black.png"></div>

# Auto366

天学网自动化答题工具！解放双手，提高学习效率！

## 警告

### 本工具仅供学习和研究使用，**严禁商用**！

## 项目简介

Auto366 是一个专为天学网设计的自动化答题工具，支持多种题型自动填写，辅助工具有听力答案提取和等待音频替换。通过智能检测下载的练习文件，自动提取答案并完成填写，让您专注于学习而不是重复性操作。

## TODOS

1. 用户输入当前缩放率，自动处理位置偏差 (✔)
2. 区域坐标记忆(LocalStorage) (✔)
3. 听力答案获取，加入删除文件 (✔)
4. 增加设置选项，可控制存档路径 (即将完成)
5. 大改单词pk ()
6. 加入万能答案获取 (预计3天内完成)

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

但此项目严格禁止用于商业用途，包括但不限于转卖、推广以及各类牟利行为等。

---

**免责声明**：本工具仅供学习和研究使用，使用者需自行承担使用风险，开发者不承担任何法律责任。
