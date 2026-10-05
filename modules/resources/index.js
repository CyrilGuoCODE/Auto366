const moduleLog = require('../logging').create('资源');
const { app } = require('electron');
const ipcMain = require('../register').forModule('resources');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { createHash } = require('crypto');
const StreamZip = require('node-stream-zip');
const catalog = require('./catalog');

class ResourceDownloader {
  constructor({ root = path.join(os.homedir(), '.Auto366', 'resources'), groups = catalog } = {}) {
    this.root = path.resolve(root);
    this.groups = new Map();
    this.mainWindow = null;
    this.active = null;
    this.lastSource = null;
    this.ready = Object.create(null);
    this.localManifests = Object.create(null);
    this._lastLogPct = Object.create(null);
    for (const [group, definition] of Object.entries(groups)) this.register(group, definition);
  }

  // 仅主进程登记来源；renderer 只能选择已登记的分组及清单资源。
  register(group, definition) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(group) || group === 'manifests') throw new Error('无效资源分组');
    if (this.active?.group === group) throw new Error('下载期间不能修改资源定义');
    if (!definition || (!definition.manifest && !definition.manifestUrls?.length)) throw new Error('缺少资源清单');
    this.groups.set(group, definition);
    return this;
  }
  _definition(group) {
    if (!this.groups.has(group)) throw new Error('资源分组未登记');
    return this.groups.get(group);
  }
  // 安装、移动及清理均限制在指定根目录内，并拒绝现有符号链接。
  _inside(root, relative) {
    const parts = String(relative).replace(/\\/g, '/').split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) throw new Error('资源路径不安全');
    const target = path.resolve(root, ...parts);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('资源路径越界');
    let current = target;
    while (true) {
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('资源路径不能包含符号链接');
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return target;
  }
  userDir(group) { this._definition(group); return this._inside(this.root, group); }
  legacySourceDir(group) {
    this._definition(group);
    return path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), group);
  }
  migrateLegacy() {
    if (!app.isPackaged) return;
    for (const [group, definition] of this.groups) {
      if (!definition.migrateLegacy) continue;
      try {
        const src = this.legacySourceDir(group), dest = this.userDir(group);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.copySync(src, dest);
          this.ready[group] = true;
          moduleLog.log(`已迁移 ${group} 资源`);
        }
      } catch (error) { moduleLog.warn(`迁移 ${group} 失败：`, error.message); }
    }
  }
  _localManifestPath(group) {
    this._definition(group);
    return this._inside(this.root, `manifests/${group}.json`);
  }
  _readLocalManifest(group) {
    if (this.localManifests[group]) return this.localManifests[group];
    try { this.localManifests[group] = fs.readJsonSync(this._localManifestPath(group)); } catch (_) {}
    return this.localManifests[group] || null;
  }
  _writeLocalManifest(group, manifest) {
    const dest = this._localManifestPath(group);
    const temporary = this._inside(this.root, `manifests/${group}.json.tmp`);
    fs.outputJsonSync(temporary, manifest, { spaces: 2 });
    fs.renameSync(temporary, dest);
    this.localManifests[group] = manifest;
  }

  async _httpGet(url, { headers = {}, signal } = {}, redirects = 0) {
    if (redirects > 5) throw new Error('资源重定向次数过多');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('无效资源 URL');
    const res = await new Promise((resolve, reject) => {
      const req = (parsed.protocol === 'https:' ? https : http).get(parsed, {
        headers: { 'User-Agent': 'Auto366', ...headers }, signal,
      }, resolve);
      req.setTimeout(30000, () => req.destroy(new Error('资源请求超时')));
      req.on('error', reject);
    });
    res.on('error', () => {});
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return this._httpGet(new URL(res.headers.location, parsed).href, { headers, signal }, redirects + 1);
    }
    return res;
  }
  async _getText(url, signal) {
    const res = await this._httpGet(url, { signal });
    if (res.statusCode !== 200) { res.resume(); throw new Error(`清单 HTTP ${res.statusCode}`); }
    const chunks = []; let length = 0;
    for await (const chunk of res) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) { res.destroy(); throw new Error('资源清单过大'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  async _fetchManifest(group, signal) {
    const definition = this._definition(group);
    if (definition.manifest) return { manifest: definition.manifest, source: 'registered' };
    let lastError;
    for (const entry of definition.manifestUrls) {
      if (signal?.aborted) throw new Error('下载已取消');
      const source = typeof entry === 'string' ? { url: entry, source: 'main' } : entry;
      try {
        const parsed = JSON.parse(await this._getText(source.url, signal));
        return { manifest: source.key ? parsed[source.key] || parsed : parsed, source: source.source };
      } catch (error) { lastError = error; }
    }
    throw new Error('获取资源清单失败：' + (lastError?.message || '没有可用来源'));
  }
  async downloadFile(url, dest, { expectedSize = 0, onProgress, signal } = {}) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let existing = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (expectedSize && existing === expectedSize) { onProgress?.(existing); return; }
    if (expectedSize && existing > expectedSize) existing = 0;
    const res = await this._httpGet(url, { signal, headers: existing ? { Range: `bytes=${existing}-` } : {} });
    if (![200, 206].includes(res.statusCode)) { res.resume(); throw new Error(`下载 HTTP ${res.statusCode}`); }
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(res.headers['content-range'] || '');
    if (res.statusCode === 206 && (!range || Number(range[1]) !== existing)) {
      res.destroy(); throw new Error('断点续传位置不一致');
    }
    const start = res.statusCode === 206 ? existing : 0;
    let received = start;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (expectedSize && received > expectedSize) return callback(new Error('资源大小超出清单'));
      onProgress?.(received);
      callback(null, chunk);
    } });
    await pipeline(res, meter, fs.createWriteStream(dest, { flags: start ? 'a' : 'w' }), { signal });
    if (expectedSize && received !== expectedSize) throw new Error('资源下载不完整');
  }
  async extractZip(zipPath, destDir, task) {
    // 兼容旧包的反斜杠路径；手动检查名称，只写普通文件，不创建包内链接。
    const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    try {
      const targets = new Set();
      const files = Object.values(await zip.entries()).map(entry => {
        const target = this._inside(destDir, entry.name.replace(/\\/g, '/').replace(/\/$/, ''));
        if (targets.has(target.toLowerCase())) throw new Error('压缩包包含重复路径');
        targets.add(target.toLowerCase());
        return { entry, target };
      });
      for (const { entry, target } of files) {
        if (task?.aborted) throw new Error('下载已取消');
        if (entry.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await pipeline(await zip.stream(entry.name), fs.createWriteStream(target, { flags: 'wx' }), { signal: task?.controller.signal });
      }
    } finally { await zip.close(); }
  }
  _resource(group, item) {
    const archive = item.archive, asset = archive || item.file;
    if (!asset || !item.name) throw new Error('资源定义缺少 name 或 archive/file');
    const filename = asset.filename || (archive ? `${group}.zip` : null);
    if (!filename || filename.includes('/') || filename.includes('\\')) throw new Error('无效资源文件名');
    if (asset.size !== undefined && (!Number.isSafeInteger(asset.size) || asset.size < 0)) throw new Error('无效资源大小');
    if (asset.sha256 && !/^[a-f0-9]{64}$/i.test(asset.sha256)) throw new Error('无效资源 SHA256');
    const relative = item.extractTo || group;
    if (relative !== group && !relative.replace(/\\/g, '/').startsWith(group + '/')) throw new Error('资源只能安装到自身分组');
    const directory = this._inside(this.root, relative);
    const dest = archive ? directory : this._inside(directory, filename);
    const urls = [
      ...(asset.url ? [{ url: asset.url, source: 'main' }] : []),
      ...(asset.mirrors || []).map(url => ({ url, source: 'mirror' })),
      ...(this._definition(group).assetBases || []).map(base => ({ url: base.url + encodeURIComponent(item.releaseAsset || filename), source: base.source })),
    ];
    if (!urls.length) throw new Error('没有资源下载地址');
    return { archive: !!archive, asset, dest, filename, urls };
  }
  async ensure(group, model, { force = false } = {}) {
    if (this.active) return { ready: false, message: '已有下载任务进行中，请等待完成' };
    // 清单请求也占用任务，避免不同分组覆盖当前下载。
    const task = { group, model, aborted: false, controller: new AbortController() };
    let finish;
    task.finished = new Promise(resolve => { finish = resolve; });
    this.active = task;
    let error;
    try {
      this._definition(group);
      const { manifest } = await this._fetchManifest(group, task.controller.signal);
      const items = manifest.resources || manifest.models || [];
      const item = model ? items.find(entry => entry.name === model) : items[0];
      if (!item) throw new Error('清单中没有所选资源');
      const resource = this._resource(group, item);
      task.model = item.name;
      const local = this._readLocalManifest(group);
      if (force || !local || local.version !== manifest.version || local.model !== item.name || !this._present(resource)) {
        await this._runDownload(group, manifest, item, resource, task);
      }
      this.ready[group] = true;
    } catch (caught) { error = task.aborted ? '下载已取消' : caught.message; }
    finally { if (this.active === task) this.active = null; finish(); }
    return error ? { ready: false, message: error } : { ready: true, status: this._buildStatus(group) };
  }
  _present(resource) {
    try {
      const stat = fs.statSync(resource.dest);
      return resource.archive ? stat.isDirectory() && fs.readdirSync(resource.dest).length > 0
        : stat.isFile() && (!resource.asset.size || stat.size === resource.asset.size);
    } catch (_) { return false; }
  }
  async _runDownload(group, manifest, item, resource, task) {
    const temp = this._inside(this.root, `.download/${group}`);
    const download = this._inside(temp, 'payload');
    const stage = this._inside(temp, 'staging');
    const backup = this._inside(temp, 'previous');
    // 清理路径经 _inside 校验。失败回滚遗留的备份必须保留。
    if (fs.existsSync(backup)) throw new Error('检测到待恢复的资源备份，请先恢复：' + backup);
    fs.ensureDirSync(temp);
    fs.removeSync(stage);
    let success = false, lastError;
    for (const [index, source] of resource.urls.entries()) {
      if (task.aborted) throw new Error('下载已取消');
      // 没有哈希时不复用来源不明的旧半包，也不拼接不同镜像的内容。
      if (index > 0 || !resource.asset.sha256) fs.removeSync(download);
      try {
        await this._downloadWithProgress(source.url, download, resource.asset.size || 0, task, source.source);
        if (resource.asset.sha256) {
          const hash = createHash('sha256');
          for await (const chunk of fs.createReadStream(download)) hash.update(chunk);
          if (hash.digest('hex') !== resource.asset.sha256.toLowerCase()) {
            fs.removeSync(download); throw new Error('资源 SHA256 校验失败');
          }
        }
        success = true; break;
      } catch (error) { lastError = error; }
    }
    if (!success) throw lastError || new Error('资源下载失败');
    try {
      if (task.aborted) throw new Error('下载已取消');
      if (resource.archive) {
        this._emitProgress({ group, model: task.model, stage: 'extract' });
        await this.extractZip(download, stage, task);
        if (!fs.existsSync(stage) || !fs.readdirSync(stage).length) throw new Error('压缩包没有资源');
      } else { await fs.copy(download, stage); }
      if (task.aborted) throw new Error('下载已取消');
      fs.ensureDirSync(path.dirname(resource.dest));
      const previous = fs.existsSync(resource.dest);
      if (previous) fs.renameSync(resource.dest, backup);
      try {
        fs.renameSync(stage, resource.dest);
        this._writeLocalManifest(group, { group, version: manifest.version, updatedAt: manifest.updatedAt || null, model: item.name });
      } catch (error) {
        fs.removeSync(resource.dest);
        if (previous) fs.renameSync(backup, resource.dest);
        throw error;
      }
      fs.removeSync(backup);
      fs.removeSync(download);
      this._emitProgress({ group, model: task.model, stage: 'done', source: this.lastSource });
    } finally { fs.removeSync(stage); }
  }

  _emitProgress(data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('a366-download-progress', data);
      } catch (e) { /* 忽略 */ }
      // 同步输出到日志面板（按 2% 粒度节流，避免刷屏）
      try {
        const key = String(data.group || '') + '/' + String(data.model || '');
        const prev = this._lastLogPct[key] === undefined ? -1 : this._lastLogPct[key];
        const isDownload = data.stage === 'download';
        const isExtract = data.stage === 'extract';
        const isDone = data.stage === 'done';
        if (isExtract || isDone || (isDownload && typeof data.percent === 'number' && data.percent - prev >= 2)) {
          if (isDownload) this._lastLogPct[key] = data.percent;
          let msg = '';
          if (isDownload) msg = `[资源下载] ${data.group}${data.model ? '/' + data.model : ''} 下载中 ${data.percent}%`;
          else if (isExtract) msg = `[资源下载] ${data.group}${data.model ? '/' + data.model : ''} 正在解压`;
          else msg = `[资源下载] ${data.group}${data.model ? '/' + data.model : ''} 下载完成`;
          this.mainWindow.webContents.send('rule-log', moduleLog.event({
            type: isDone ? 'success' : 'info',
            message: msg,
            details: data.source ? `来源: ${data.source}` : '',
          }));
        }
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
        signal: task.controller.signal,
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

  _buildStatus(group) {
    const dir = this.userDir(group);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) {}
    const local = this._readLocalManifest(group);
    return {
      group, ready: !!this.ready[group], models: entries.filter(entry => entry.isDirectory()).map(entry => entry.name),
      resources: entries.map(entry => entry.name), localVersion: local?.version || null,
      downloading: this.active?.group === group, source: this.lastSource || null,
    };
  }
  getStatus(group) {
    return group ? this._buildStatus(group) : Object.fromEntries([...this.groups.keys()].map(key => [key, this._buildStatus(key)]));
  }
  async download(group, model) {
    const result = await this.ensure(group, model, { force: true });
    return result.ready ? { success: true, status: result.status } : { success: false, message: result.message };
  }
  abort(group) {
    if (!this.active || this.active.group !== group) return { success: false, message: '该分组没有正在进行的下载' };
    this.active.aborted = true;
    this.active.controller.abort();
    return { success: true, message: '已请求取消下载' };
  }
  init() { fs.ensureDirSync(this.root); this.migrateLegacy(); }
  async stop() {
    const task = this.active;
    if (!task) return;
    this.abort(task.group);
    await task.finished;
  }
  registerIpcHandlers(mainWindow) {
    this.mainWindow = mainWindow;
    ipcMain.handle('get-a366-resources', async () => this.getStatus());
    ipcMain.handle('download-a366-resource', async (_event, group, opts) => this.download(group, opts?.model));
    ipcMain.handle('get-a366-download-status', async (_event, group) => this.getStatus(group));
    ipcMain.handle('abort-a366-download', async (_event, group) => this.abort(group));
  }
}
module.exports = ResourceDownloader;
