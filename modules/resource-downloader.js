/*
 * ResourceDownloader —— 资源通用下载模块 (主进程侧)
 * 主源:  https://366static.submergme.xyz  (A366 子域，根目录直接部署)
 * 备用源: GitHub Release（经 gh-proxy 多镜像加速）
 */

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveExtractedRoot } = require('./archive-layout');
const execFileP = promisify(execFile);

// 主源前缀（A366 子域根）
const MAIN_PREFIX = 'https://366static.submergme.xyz';
// GitHub 加速代理镜像（按序重试）
const GH_PROXIES = [
  'https://gh-proxy.org/',
  'https://cdn.gh-proxy.org/',
  'https://axisnow.gh-proxy.org/',
];
// 资源专用 release：固定 tag，直接按 download URL 取文件（不经 GitHub API，避免限流）
const GITHUB_OWNER_REPO = 'CyrilGuoCODE/Auto366';
const GITHUB_RESOURCES_TAG = 'static-resources';
const GITHUB_DL_PREFIX = `https://github.com/${GITHUB_OWNER_REPO}/releases/download/${GITHUB_RESOURCES_TAG}`;

// 用户数据目录下的资源根
const USER_RES_DIR = path.join(os.homedir(), '.Auto366', 'resources');

// 已纳入可选下载的分组
const GROUPS = ['tts', 'tun'];

class ResourceDownloader {
  constructor() {
    this.mainWindow = null;
    this.active = null;        // 当前任务 { group, model, aborted }
    this.lastSource = null;    // 最近一次下载来源 main/github
    this.ready = {};           // group -> bool（迁移/下载完成后置 true）
    this.localManifests = {};  // group -> 本地 manifest 缓存
  }

  // ------------------------------------------------------------
  //  路径
  // ------------------------------------------------------------
  userDir(group) {
    return path.join(USER_RES_DIR, group);
  }

  // 旧版安装目录资源位置（打包后 process.resourcesPath，开发时 appPath/resources）
  legacySourceDir(group) {
    return !app.isPackaged
      ? path.join(app.getAppPath(), 'resources', group)
      : path.join(process.resourcesPath, group);
  }

  // ------------------------------------------------------------
  //  迁移旧版安装目录资源（仅打包环境执行一次）
  // ------------------------------------------------------------
  migrateLegacy() {
    if (!app.isPackaged) return; // 开发环境直接读 appPath/resources 兜底，不复制
    for (const group of GROUPS) {
      const src = this.legacySourceDir(group);
      const dst = this.userDir(group);
      try {
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copySync(src, dst);
          this.ready[group] = true;
          console.log(`[ResourceDownloader] 已迁移旧版 ${group} 资源: ${src} -> ${dst}`);
        }
      } catch (e) {
        console.warn(`[ResourceDownloader] 迁移 ${group} 失败:`, e.message);
      }
    }
  }

  // ------------------------------------------------------------
  //  本地 manifest 读写
  // ------------------------------------------------------------
  _localManifestPath(group) {
    return path.join(USER_RES_DIR, 'manifests', `${group}.json`);
  }

  _readLocalManifest(group) {
    if (this.localManifests[group]) return this.localManifests[group];
    try {
      const p = this._localManifestPath(group);
      if (fs.existsSync(p)) {
        this.localManifests[group] = JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) { /* 忽略 */ }
    return this.localManifests[group] || null;
  }

  _writeLocalManifest(group, manifest) {
    this.localManifests[group] = manifest;
    const p = this._localManifestPath(group);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(manifest, null, 2));
  }

  // ------------------------------------------------------------
  //  基础 HTTP GET（返回响应流，交给回调处理；支持重定向）
  // ------------------------------------------------------------
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { headers: { 'User-Agent': 'Auto366' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          this._httpGet(next).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        resolve(res);
      });
      req.on('error', reject);
    });
  }

  // 获取文本响应体
  async _getText(url) {
    const res = await this._httpGet(url);
    return new Promise((resolve, reject) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
  }

  // ------------------------------------------------------------
  //  下载文件（支持 Range 断点续传）
  // ------------------------------------------------------------
  downloadFile(url, dest, { expectedSize, onProgress, isAborted } = {}) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let existing = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (expectedSize && existing >= expectedSize) { resolve(); return; }

      const headers = { 'User-Agent': 'Auto366' };
      if (existing > 0) headers['Range'] = `bytes=${existing}-`;

      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          req.destroy();
          this.downloadFile(next, dest, { expectedSize, onProgress, isAborted }).then(resolve, reject);
          return;
        }
        let start = res.statusCode === 206 ? existing : 0;
        // 非 206 时从头写（截断）
        if (res.statusCode !== 206 && existing > 0) {
          fs.truncateSync(dest, 0);
          existing = 0;
          start = 0;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const fd = fs.openSync(dest, 'a');
        let received = start;
        res.on('data', (chunk) => {
          if (isAborted && isAborted()) { res.destroy(); return; }
          fs.writeSync(fd, chunk, 0, chunk.length, received);
          received += chunk.length;
          if (onProgress) onProgress(received);
        });
        res.on('end', () => { try { fs.closeSync(fd); } catch (e) { /* 忽略 */ } resolve(); });
        res.on('error', (e) => { try { fs.closeSync(fd); } catch (x) { /* 忽略 */ } reject(e); });
      });
      req.on('error', reject);
    });
  }

  // ------------------------------------------------------------
  // 解压 zip（用系统 tar，兼容反斜杠路径的 zip，避免 node-stream-zip 恶意条目误报）
  async extractZip(zipPath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    await execFileP('tar', ['-xf', zipPath, '-C', destDir]);
  }

  // ------------------------------------------------------------
  //  清单拉取
  // ------------------------------------------------------------
  // 主源
  async _fetchManifestMain(group) {
    const url = `${MAIN_PREFIX}/manifests/${group}.json`;
    const body = await this._getText(url);
    return JSON.parse(body);
  }

  // GitHub Release（多镜像）——直接按固定 download URL 取清单，不经 GitHub API
  async _fetchManifestGithub(group) {
    let lastErr = null;
    for (const proxy of GH_PROXIES) {
      try {
        const mBody = await this._getText(proxy + `${GITHUB_DL_PREFIX}/manifests.json`);
        const parsed = JSON.parse(mBody);
        return parsed[group] || parsed;
      } catch (e) {
        lastErr = e;
        console.warn(`[ResourceDownloader] GitHub 镜像 ${proxy} 获取 ${group} 清单失败:`, e.message);
      }
    }
    throw new Error('所有 GitHub 镜像均无法获取清单: ' + (lastErr ? lastErr.message : ''));
  }

  // 拉取清单：主源优先，失败回退 GitHub
  async _fetchManifest(group) {
    try {
      return { manifest: await this._fetchManifestMain(group), source: 'main' };
    } catch (e) {
      console.warn(`[ResourceDownloader] 主源 ${group} 清单失败，回退 GitHub:`, e.message);
      const m = await this._fetchManifestGithub(group);
      return { manifest: m, source: 'github' };
    }
  }

  // ------------------------------------------------------------
  //  进度上报（推送到渲染进程）
  // ------------------------------------------------------------
  _emitProgress(data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('a366-download-progress', data);
      } catch (e) { /* 忽略 */ }
    }
  }

  _downloadWithProgress(url, dest, expectedSize, task, source) {
    this.lastSource = source;
    return new Promise((resolve, reject) => {
      let received = 0;
      let lastEmit = 0;
      this.downloadFile(url, dest, {
        expectedSize,
        isAborted: () => task.aborted,
        onProgress: (r) => {
          received = r;
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            this._emitProgress({
              group: task.group, model: task.model, stage: 'download', source,
              received, total: expectedSize,
              percent: expectedSize ? Math.min(100, Math.round((received / expectedSize) * 100)) : 0,
            });
          }
        },
      }).then(() => {
        this._emitProgress({
          group: task.group, model: task.model, stage: 'download', source,
          received, total: expectedSize,
          percent: expectedSize ? Math.min(100, Math.round((received / expectedSize) * 100)) : 0,
        });
        resolve();
      }, reject);
    });
  }

  // ------------------------------------------------------------
  //  核心：确保分组资源就绪
  // ------------------------------------------------------------
  async ensure(group, model, { force } = {}) {
    if (this.active && this.active.group === group) {
      return { ready: false, message: '该资源正在下载中', status: this._buildStatus(group) };
    }

    // 拉取清单
    let manifest;
    try {
      const fetched = await this._fetchManifest(group);
      manifest = fetched.manifest;
    } catch (e) {
      return { ready: false, message: '获取资源清单失败：' + e.message };
    }

    // 选择模型（tts 多模型，tun 单模型）
    const models = (manifest && manifest.models) || [];
    let modelDef = null;
    if (model) modelDef = models.find((m) => m.name === model) || null;
    if (!modelDef) modelDef = models[0] || null;
    if (!modelDef) return { ready: false, message: '清单中没有可下载的模型' };

    // 本地已就绪且版本一致 → 直接返回
    const local = this._readLocalManifest(group);
    if (!force && local && local.version === manifest.version && this._modelPresent(modelDef)) {
      this.ready[group] = true;
      return { ready: true, status: this._buildStatus(group) };
    }

    // 执行下载
    const task = { group, model: modelDef.name, aborted: false };
    this.active = task;
    try {
      await this._runDownload(group, manifest, modelDef, task);
      this.ready[group] = true;
      return { ready: true, status: this._buildStatus(group) };
    } catch (e) {
      return { ready: false, message: e.message, status: this._buildStatus(group) };
    } finally {
      if (this.active === task) this.active = null;
    }
  }

  async _runDownload(group, manifest, modelDef, task) {
    const extractTo = modelDef.extractTo || group;
    const destDir = path.join(USER_RES_DIR, extractTo);
    const downloadDir = path.join(USER_RES_DIR, '.download', group);
    const zipName = (modelDef.archive && modelDef.archive.filename) || `${group}.zip`;
    const zipPath = path.join(downloadDir, zipName);
    const expectedSize = (modelDef.archive && modelDef.archive.size) || 0;
    const mainUrl = (modelDef.archive && modelDef.archive.url) || null;
    const assetName = modelDef.releaseAsset || zipName;

    fs.mkdirSync(downloadDir, { recursive: true });

    // 1) 下载 zip（主源优先，失败回退 GitHub 多镜像）
    let downloaded = false;
    if (mainUrl) {
      try {
        await this._downloadWithProgress(mainUrl, zipPath, expectedSize, task, 'main');
        downloaded = true;
      } catch (e) {
        console.warn(`[ResourceDownloader] 主源下载 ${group} 失败，回退 GitHub:`, e.message);
      }
    }
    if (!downloaded) {
      // 直接按固定 download URL 下载（不经 GitHub API）
      const ghUrl = `${GITHUB_DL_PREFIX}/${assetName}`;
      let got = false;
      let lastErr = null;
      for (const proxy of GH_PROXIES) {
        if (task.aborted) break;
        try {
          await this._downloadWithProgress(proxy + ghUrl, zipPath, expectedSize, task, 'github');
          got = true;
          break;
        } catch (e) {
          lastErr = e;
          console.warn(`[ResourceDownloader] GitHub 镜像 ${proxy} 下载 ${group} 失败:`, e.message);
        }
      }
      if (!got) throw new Error('GitHub 下载失败：' + (lastErr ? lastErr.message : '已取消'));
    }

    if (task.aborted) throw new Error('下载已取消');

    // 2) 解包到临时目录
    this._emitProgress({ group, model: task.model, stage: 'extract' });
    const extractDir = path.join(downloadDir, 'extracted-' + Date.now());
    await this.extractZip(zipPath, extractDir);

    // 3) 原子替换目标目录。兼容旧资源包里重复的顶层目录（tun/tun/*）。
    const extractedRoot = resolveExtractedRoot(extractDir, extractTo);
    if (fs.existsSync(destDir)) fs.removeSync(destDir);
    fs.renameSync(extractedRoot, destDir);
    if (extractedRoot !== extractDir) fs.removeSync(extractDir);

    // 4) 写本地 manifest + 清理临时文件
    this._writeLocalManifest(group, {
      group,
      version: manifest.version,
      updatedAt: manifest.updatedAt || null,
      model: modelDef.name,
    });
    try { fs.removeSync(zipPath); } catch (e) { /* 忽略 */ }
    this._emitProgress({ group, model: task.model, stage: 'done', source: this.lastSource });
  }

  // 解包后是否已存在该模型资源
  _modelPresent(modelDef) {
    const destDir = path.join(USER_RES_DIR, modelDef.extractTo || modelDef.group || '');
    if (!fs.existsSync(destDir)) return false;
    try {
      return fs.readdirSync(destDir).length > 0;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------
  //  状态
  // ------------------------------------------------------------
  _listModels(group) {
    const dir = this.userDir(group);
    const out = [];
    try {
      if (fs.existsSync(dir)) {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          if (d.isDirectory()) out.push(d.name);
        }
      }
    } catch (e) { /* 忽略 */ }
    return out;
  }

  _buildStatus(group) {
    return {
      group,
      ready: !!this.ready[group],
      models: this._listModels(group),
      localVersion: (this._readLocalManifest(group) || {}).version || null,
      downloading: !!(this.active && this.active.group === group),
      source: this.lastSource || null,
    };
  }

  getStatus(group) {
    if (group) return this._buildStatus(group);
    const out = {};
    for (const g of GROUPS) out[g] = this._buildStatus(g);
    return out;
  }

  // ------------------------------------------------------------
  //  主动下载 / 取消
  // ------------------------------------------------------------
  async download(group, model, opts) {
    const options = opts || {};
    if (this.active) {
      return { success: false, message: '已有下载任务进行中，请等待完成' };
    }
    const result = await this.ensure(group, model, { force: true });
    return result.ready
      ? { success: true, status: result.status }
      : { success: false, message: result.message };
  }

  abort(group) {
    if (this.active && this.active.group === group) {
      this.active.aborted = true;
      return { success: true, message: '已请求取消下载' };
    }
    return { success: false, message: '该分组没有正在进行的下载' };
  }

  // ------------------------------------------------------------
  //  IPC
  // ------------------------------------------------------------
  init() {
    fs.mkdirSync(USER_RES_DIR, { recursive: true });
    this.migrateLegacy();
  }

  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;

    ipcMain.handle('get-a366-resources', async () => {
      return this.getStatus();
    });

    ipcMain.handle('download-a366-resource', async (event, group, opts) => {
      const options = opts || {};
      return this.download(group, options.model, options);
    });

    ipcMain.handle('get-a366-download-status', async (event, group) => {
      return this._buildStatus(group);
    });

    ipcMain.handle('abort-a366-download', async (event, group) => {
      return this.abort(group);
    });
  }
}

module.exports = ResourceDownloader;
