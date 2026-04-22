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

### 新版本已完成

- 重构项目底层架构
- 加入一键打开天学网(通过注册表获取路径)
- 加入监听日志搜索功能
- 合并删除Auto366缓存和删除天学网缓存
- WEB端修复答案查看样式，兼容新的排序算法

### BUG问题

- 无

### TODO新功能

#### 短期更新

- WEB端加入贡献者与捐赠者页面
- WEB端加入反馈状态跟踪
- WEB端加入新公共下载API加速规则集文件下载
- 加入加解密模块
- 注入后将自动化程序运行日志上传到5290/logs端口
- 首次使用时step by step教程

#### 长期更新

- 加入天学网进程加速(基于OpenSpeedy)
- 加入听力自动化

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

***

**免责声明**：本工具仅供学习和研究使用，使用者需自行承担使用风险，开发者不承担任何法律责任。
