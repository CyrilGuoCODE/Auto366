const { app, dialog } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

class CertificateManager {
  constructor() {
    this.certDir = path.join(os.homedir(), '.Auto366', 'certs');
    this.keyPath = path.join(this.certDir, 'key.pem');
    this.certPath = path.join(this.certDir, 'cert.pem');
    this.pfxPath = path.join(this.certDir, 'cert.pfx');
  }

  // 检查证书是否存在
  checkCertificate() {
    try {
      // 确保证书目录存在
      if (!fs.existsSync(this.certDir)) {
        fs.mkdirSync(this.certDir, { recursive: true });
      }

      // 检查证书文件是否存在
      const keyExists = fs.existsSync(this.keyPath);
      const certExists = fs.existsSync(this.certPath);
      const pfxExists = fs.existsSync(this.pfxPath);

      return keyExists && certExists && pfxExists;
    } catch (error) {
      console.error('检查证书失败:', error);
      return false;
    }
  }

  // 导入证书到系统
  async importCertificate() {
    try {
      if (!await this.certificateExists()) {
        console.log('证书文件不存在:', this.certPath);
        return { success: false, error: '证书文件不存在', status: 'not_found' };
      }

      // 开始导入证书
      console.log('开始导入证书...');
      const result = await this.addCertificateToStore();
      
      if (result.success) {
        console.log('证书导入成功');
        result.status = 'success';
      } else {
        console.log('证书导入失败:', result.error);
        result.status = 'error';
      }
      return result;
    } catch (error) {
      console.error('证书导入失败:', error);
      return { success: false, error: error.message, status: 'error' };
    }
  }

  // 检查证书文件是否存在
  async certificateExists() {
    try {
      await fs.promises.access(this.certPath);
      return true;
    } catch {
      return false;
    }
  }

  // 添加证书到存储
  async addCertificateToStore() {
    return new Promise(async (resolve) => {
      // 首先尝试PowerShell方法
      const powershellResult = await this.tryPowerShellImport();
      if (powershellResult.success) {
        resolve(powershellResult);
        return;
      }
      
      // 如果PowerShell失败，尝试使用certutil
      console.log('PowerShell方法失败，尝试使用certutil...');
      const certutilResult = await this.tryCertutilImport();
      if (certutilResult.success) {
        resolve(certutilResult);
        return;
      }
      
      // 如果certutil失败，尝试使用PowerShell证书存储方法
      console.log('certutil方法失败，尝试使用PowerShell证书存储方法...');
      const storeResult = await this.tryCertlmImport();
      if (storeResult.success) {
        resolve(storeResult);
        return;
      }
      
      console.log('证书存储方法失败，尝试使用简单PowerShell命令...');
      const simpleResult = await this.trySimplePowerShellImport();
      resolve(simpleResult);
    });
  }

  // 尝试PowerShell导入
  async tryPowerShellImport() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const command = `powershell -ExecutionPolicy Bypass -Command "try { $cert = Import-Certificate -FilePath '${this.certPath}' -CertStoreLocation 'Cert:\\LocalMachine\\Root' -ErrorAction Stop; Write-Host 'SUCCESS: Certificate imported with thumbprint' $cert.Thumbprint } catch { Write-Host 'ERROR:' $_.Exception.Message }"`;
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        console.log('PowerShell证书导入输出:', stdout);
        console.log('PowerShell证书导入:', stderr);
        
        if (error) {
          resolve({ success: false, error: `PowerShell命令执行失败: ${error.message}` });
        } else if (stdout.includes('SUCCESS:')) {
          resolve({ success: true, message: '证书导入成功 (PowerShell)' });
        } else if (stdout.includes('ERROR:')) {
          const errorMsg = stdout.split('ERROR:')[1]?.trim() || '未知错误';
          resolve({ success: false, error: `PowerShell错误: ${errorMsg}` });
        } else {
          resolve({ success: false, error: 'PowerShell证书导入失败，未收到预期响应' });
        }
      });
    });
  }

  // 尝试certutil导入
  async tryCertutilImport() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const command = `certutil -addstore Root "${this.certPath}"`;
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        console.log('certutil证书导入输出:', stdout);
        console.log('certutil证书导入错误:', stderr);
        
        if (error) {
          resolve({ success: false, error: `certutil命令执行失败: ${error.message}` });
        } else if (stdout.includes('成功') || stdout.includes('Succeeded') || stdout.includes('Certificate added')) {
          resolve({ success: true, message: '证书导入成功 (certutil)' });
        } else {
          resolve({ success: false, error: 'certutil证书导入失败，未收到成功响应' });
        }
      });
    });
  }

  // 尝试证书存储导入
  async tryCertlmImport() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const command = `powershell -ExecutionPolicy Bypass -Command "try { $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine'); $store.Open('ReadWrite'); $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${this.certPath}'); $store.Add($cert); $store.Close(); Write-Host 'SUCCESS: Certificate added to store' } catch { Write-Host 'ERROR:' $_.Exception.Message }"`;
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        console.log('证书存储导入输出:', stdout);
        console.log('证书存储导入错误:', stderr);
        
        if (error) {
          resolve({ success: false, error: `证书存储导入失败: ${error.message}` });
        } else if (stdout.includes('SUCCESS:')) {
          resolve({ success: true, message: '证书导入成功 (证书存储)' });
        } else if (stdout.includes('ERROR:')) {
          const errorMsg = stdout.split('ERROR:')[1]?.trim() || '未知错误';
          resolve({ success: false, error: `证书存储错误: ${errorMsg}` });
        } else {
          resolve({ success: false, error: '证书存储导入失败，未收到预期响应' });
        }
      });
    });
  }

  // 尝试简单PowerShell导入
  async trySimplePowerShellImport() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      // 使用最简单的PowerShell命令
      const command = `powershell -ExecutionPolicy Bypass -Command "Import-Certificate -FilePath '${this.certPath}' -CertStoreLocation 'Cert:\\LocalMachine\\Root'"`;
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        console.log('简单PowerShell证书导入输出:', stdout);
        console.log('简单PowerShell证书导入:', stderr);
        
        if (error) {
          resolve({ success: false, error: `简单PowerShell命令执行失败: ${error.message}` });
        } else {
          resolve({ success: true, message: '证书导入成功 (简单PowerShell)' });
        }
      });
    });
  }

  // 强制导入证书
  async forceImportCertificate() {
    try {
      if (!await this.certificateExists()) {
        console.log('证书文件不存在:', this.certPath);
        return { success: false, error: '证书文件不存在', status: 'not_found' };
      }

      console.log('强制导入证书，忽略检查结果...');
      const result = await this.addCertificateToStore();
      
      if (result.success) {
        console.log('证书强制导入成功');
        result.status = 'success';
      } else {
        console.log('证书强制导入失败:', result.error);
        result.status = 'error';
      }
      return result;
    } catch (error) {
      console.error('证书强制导入失败:', error);
      return { success: false, error: error.message, status: 'error' };
    }
  }

  // 生成自签名证书
  generateCertificate() {
    try {
      // 确保证书目录存在
      if (!fs.existsSync(this.certDir)) {
        fs.mkdirSync(this.certDir, { recursive: true });
      }

      // 生成私钥
      execSync(`openssl genrsa -out "${this.keyPath}" 2048`);

      // 生成证书请求
      execSync(`openssl req -new -key "${this.keyPath}" -out "${path.join(this.certDir, 'csr.pem')}" -subj "/CN=Auto366 Proxy"`);

      // 生成自签名证书
      execSync(`openssl x509 -req -days 3650 -in "${path.join(this.certDir, 'csr.pem')}" -signkey "${this.keyPath}" -out "${this.certPath}"`);

      // 生成PFX文件（用于Windows）
      execSync(`openssl pkcs12 -export -out "${this.pfxPath}" -inkey "${this.keyPath}" -in "${this.certPath}" -passout pass:Auto366`);

      // 清理临时文件
      if (fs.existsSync(path.join(this.certDir, 'csr.pem'))) {
        fs.unlinkSync(path.join(this.certDir, 'csr.pem'));
      }

      return true;
    } catch (error) {
      console.error('生成证书失败:', error);
      return false;
    }
  }

  // 安装证书到系统
  installCertificate() {
    try {
      if (!this.checkCertificate()) {
        if (!this.generateCertificate()) {
          return false;
        }
      }

      const platform = os.platform();

      switch (platform) {
        case 'win32':
          return this.installCertificateWindows();
        case 'darwin':
          return this.installCertificateMac();
        case 'linux':
          return this.installCertificateLinux();
        default:
          console.log('不支持的平台:', platform);
          return false;
      }
    } catch (error) {
      console.error('安装证书失败:', error);
      return false;
    }
  }

  // Windows系统安装证书
  installCertificateWindows() {
    try {
      // 使用certutil安装证书到受信任的根证书颁发机构
      execSync(`certutil -addstore -f "Root" "${this.certPath}"`, {
        stdio: 'ignore'
      });

      return true;
    } catch (error) {
      console.error('Windows安装证书失败:', error);
      return false;
    }
  }

  // macOS系统安装证书
  installCertificateMac() {
    try {
      // 使用security命令安装证书
      execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${this.certPath}"`, {
        stdio: 'ignore'
      });

      return true;
    } catch (error) {
      console.error('macOS安装证书失败:', error);
      return false;
    }
  }

  // Linux系统安装证书
  installCertificateLinux() {
    try {
      // 不同的Linux发行版可能有不同的证书存储位置
      const certDirs = [
        '/usr/local/share/ca-certificates/',
        '/etc/ssl/certs/'
      ];

      let installed = false;

      for (const certDir of certDirs) {
        if (fs.existsSync(certDir)) {
          const destPath = path.join(certDir, 'Auto366.crt');
          fs.copyFileSync(this.certPath, destPath);
          
          // 更新证书缓存
          try {
            execSync('update-ca-certificates', {
              stdio: 'ignore'
            });
          } catch (error) {
            // 某些系统可能没有这个命令，忽略错误
          }

          installed = true;
          break;
        }
      }

      return installed;
    } catch (error) {
      console.error('Linux安装证书失败:', error);
      return false;
    }
  }

  // 卸载证书
  uninstallCertificate() {
    try {
      const platform = os.platform();

      switch (platform) {
        case 'win32':
          return this.uninstallCertificateWindows();
        case 'darwin':
          return this.uninstallCertificateMac();
        case 'linux':
          return this.uninstallCertificateLinux();
        default:
          return false;
      }
    } catch (error) {
      console.error('卸载证书失败:', error);
      return false;
    }
  }

  // Windows系统卸载证书
  uninstallCertificateWindows() {
    try {
      // 使用certutil卸载证书
      execSync(`certutil -delstore "Root" "Auto366 Proxy"`, {
        stdio: 'ignore'
      });

      return true;
    } catch (error) {
      console.error('Windows卸载证书失败:', error);
      return false;
    }
  }

  // macOS系统卸载证书
  uninstallCertificateMac() {
    try {
      // 使用security命令卸载证书
      execSync(`sudo security delete-certificate -c "Auto366 Proxy" /Library/Keychains/System.keychain`, {
        stdio: 'ignore'
      });

      return true;
    } catch (error) {
      console.error('macOS卸载证书失败:', error);
      return false;
    }
  }

  // Linux系统卸载证书
  uninstallCertificateLinux() {
    try {
      const certPaths = [
        '/usr/local/share/ca-certificates/Auto366.crt',
        '/etc/ssl/certs/Auto366.pem'
      ];

      for (const certPath of certPaths) {
        if (fs.existsSync(certPath)) {
          fs.unlinkSync(certPath);
        }
      }

      // 更新证书缓存
      try {
        execSync('update-ca-certificates', {
          stdio: 'ignore'
        });
      } catch (error) {
        // 某些系统可能没有这个命令，忽略错误
      }

      return true;
    } catch (error) {
      console.error('Linux卸载证书失败:', error);
      return false;
    }
  }

  // 获取证书路径
  getCertificatePaths() {
    return {
      keyPath: this.keyPath,
      certPath: this.certPath,
      pfxPath: this.pfxPath
    };
  }
}

module.exports = CertificateManager;
