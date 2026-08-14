function generateTunConfig(proxyPort, selectedProcesses) {
  const processRules = selectedProcesses
    .filter((processName) => processName && processName.trim())
    .map((processName) => `  - PROCESS-NAME,${processName.trim()},Auto366Proxy`)
    .join('\n');

  return `# Auto366 TUN 强制软包模式配置 (自动生成，请勿手动修改)
allow-lan: false
mode: rule
log-level: warning
ipv6: false
find-process-mode: always

tun:
  enable: true
  # Windows system stack keeps the runtime smaller and starts faster than gVisor.
  stack: system
  dns-hijack:
    - any:53
  auto-route: true
  auto-detect-interface: true

# 流量嗅探：从 TLS SNI / HTTP Host 还原真实域名
# 关键：确保 HTTPS 流量转发到 Auto366 代理时使用域名而非 IP
sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  sniff:
    HTTP:
      ports: [80, 8080-8880]
      override-destination: true
    TLS:
      ports: [443, 8443]
      override-destination: true

dns:
  enable: true
  ipv6: false
  # fake-ip 模式：mihomo 返回虚假 IP，建立 IP↔域名映射
  # 确保 mihomo 转发 HTTPS 时一定知道目标域名
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "localhost.ptlogin2.qq.com"
    - "+.msftconnecttest.com"
    - "+.msftncsi.com"
  default-nameserver:
    - 223.5.5.5
    - 114.114.114.114
  nameserver:
    - 223.5.5.5
    - 114.114.114.114
  # Do not add fallback here: Mihomo enables GeoIP filtering for fallback by
  # default, which downloads geoip.metadb and can block or fail TUN startup.

proxies:
  - name: Auto366Proxy
    type: http
    server: 127.0.0.1
    port: ${proxyPort}

rules:
${processRules || '  - MATCH,DIRECT'}
  - MATCH,DIRECT
`;
}

module.exports = { generateTunConfig };
