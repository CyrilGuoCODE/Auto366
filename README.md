<div align=center><img src="icon_black.png"></div>

# Auto366

天学网自动化答题工具！解放双手，提高学习效率！

## 警告

### 本工具仅供学习和研究使用，**严禁商用**

## 项目简介

Auto366 是一个专为天学网设计的自动化答题工具，支持多种题型自动填写，单词pk快速自动填写，辅助工具有听力答案提取和等待音频替换。通过智能检测下载的练习文件，自动提取答案并完成填写，让您专注于学习而不是重复性操作。

B站介绍视频：[www.bilibili.com/video/BV195xLzEESR/](https://www.bilibili.com/video/BV195xLzEESR/)

官方网站/在线答案查看器：[366.cyril.qzz.io/](https://366.cyril.qzz.io/)
备用地址(暂时弃用)：[a366.netlify.app/](https://a366.netlify.app/)

## Todo List待办清单

### 新版本(v0.9.0)已完成

- 重构项目底层UI架构(基本完成)
- [新功能]加入听力自动化Beta(仅选择题)
- [新功能]添加动态ZIP注入规则功能(By Fish)
- 增强天学网启停并添加监控天学网进程(By Fish)
- [新功能]加入规则集兼容性功能并和未加密page1.js识别(By Fish)
- 修复教程自动寻找缓存目录无效(By 五羰基)
- 优化rules.json本地规则存储结构
- [新功能]单词PK自动化全面重构，加入超多新功能(By Fish)
- [新功能]加入多选请求并导出(By 五羰基)
- [新功能]新增听力修改时间（By ゼロ 五羰基 Fish）
- [新功能]新增PK修改时间（By 五羰基）
- [新功能]auto-pk词王争霸支持（By ゼロ）
- 添加版本化的内置规则集支持
- 加入遥测数据分析上传
- 加入使用协议与隐私协议

### BUG问题

- 无

### TODO新功能

#### 短期更新

- 深度UI更新
- 深色模式UI支持
- 加入Funny模式
- 优化听力自动化
- Log日志系统与通知系统优化

#### 长期更新

- 加入天学网进程加速(基于OpenSpeedy)

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

windows默认资源路径：`D:/Up366StudentFiles`

如需修改，启动应用后在设置中更改

资源路径可在天学网的设置中查看

### 快捷键

- `Ctrl+F12` - 打开开发者工具

## 您在使用中有任何问题都可以在讨论中提出

## 贡献指南

[贡献指南](https://366.cyril.qzz.io/tutorial/contributing-guide)

## 许可证

本项目采用 GNU General Public License v3.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

但此项目严格禁止其他个体将本项目用于商业用途，包括但不限于转卖、推广以及各类牟利行为等。

**隐私协议**：[隐私协议](https://366.cyril.qzz.io/tutorial/privacyPolicy)

**使用协议**：[使用协议](https://366.cyril.qzz.io/tutorial/termsOfService)

**免责声明**：本工具仅供学习和研究使用，使用者需自行承担使用风险，开发者不承担任何法律责任。
