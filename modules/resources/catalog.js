// 内置资源只是通用下载器的默认配置；业务也可在主进程调用 register() 添加分组。
const release = 'https://github.com/CyrilGuoCODE/Auto366/releases/download/static-resources/';
const mirrors = ['https://gh-proxy.org/', 'https://cdn.gh-proxy.org/', 'https://axisnow.gh-proxy.org/'];

module.exports = Object.fromEntries(['tts', 'tun'].map(group => [group, {
  manifestUrls: [
    { url: `https://366static.submergme.xyz/manifests/${group}.json`, source: 'main' },
    ...mirrors.map(proxy => ({ url: proxy + release + 'manifests.json', source: 'github', key: group })),
  ],
  assetBases: mirrors.map(proxy => ({ url: proxy + release, source: 'github' })),
  migrateLegacy: true,
}]));
