const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class CertificateManager {
  constructor() {
    this.certPath = process.cwd() + '/.http-mitm-proxy/certs/ca.pem';
  }

  async importCertificate() {
    try {
      if (!await this.certificateExists()) {
        console.log('证书文件不存在:', this.certPath);
        return { success: false, error: '证书文件不存在', status: 'not_found' };
      }

      // 先检查证书是否已存在
      // const isAlreadyImported = await this.isCertificateAlreadyImported();
      // console.log('证书检查结果:', isAlreadyImported);
      //
      // if (isAlreadyImported) {
      //   console.log('证书已经导入到受信任的根证书颁发机构');
      //   return { success: true, message: '证书已经存在于受信任的根证书颁发机构', status: 'exists' };
      // }

      // 如果证书不存在，尝试导入
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

  async certificateExists() {
    try {
      await fs.access(this.certPath);
      return true;
    } catch {
      return false;
    }
  }

  async isCertificateAlreadyImported() {
    return new Promise((resolve) => {
      const command = `powershell -ExecutionPolicy Bypass -Command "try { $certs = Get-ChildItem -Path 'Cert:\\LocalMachine\\Root' | Where-Object { $_.Subject -like '*node-mitmproxy*' -or $_.Subject -like '*mitmproxy*' -or $_.FriendlyName -like '*node-mitmproxy*' -or $_.FriendlyName -like '*mitmproxy*' }; $count = ($certs | Measure-Object).Count; if ($count -gt 0) { Write-Host 'FOUND:' $count } else { Write-Host 'NOT_FOUND' } } catch { Write-Host 'ERROR:' $_.Exception.Message }"`;
      
      exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
        console.log('证书检查输出:', stdout);
        console.log('证书检查错误:', stderr);
        if (error) {
          console.error('证书检查命令执行失败:', error);
          resolve(false);
        } else if (stdout.includes('FOUND:')) {
          const count = parseInt(stdout.split('FOUND:')[1]?.trim() || '0');
          console.log(`找到 ${count} 个相关证书`);
          resolve(count > 0);
        } else {
          console.log('未找到相关证书');
          resolve(false);
        }
      });
    });
  }

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

  async tryPowerShellImport() {
    return new Promise((resolve) => {
      const command = `powershell -ExecutionPolicy Bypass -Command "try { $cert = Import-Certificate -FilePath '${this.certPath}' -CertStoreLocation 'Cert:\\LocalMachine\\Root' -ErrorAction Stop; Write-Host 'SUCCESS: Certificate imported with thumbprint' $cert.Thumbprint } catch { Write-Host 'ERROR:' $_.Exception.Message }"`;
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        console.log('PowerShell证书导入输出:', stdout);
        console.log('PowerShell证书导入错误:', stderr);
        
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

  async tryCertutilImport() {
    return new Promise((resolve) => {
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

  async tryCertlmImport() {
    return new Promise((resolve) => {
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

  async removeCertificate() {
    return new Promise((resolve) => {
      const command = `powershell -Command "Get-ChildItem -Path 'Cert:\\LocalMachine\\Root' | Where-Object { $_.Subject -like '*node-mitmproxy*' } | Remove-Item"`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('证书删除命令执行失败:', error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true, message: '证书删除成功' });
        }
      });
    });
  }

  async trySimplePowerShellImport() {
    return new Promise((resolve) => {
      // 使用最简单的PowerShell命令
      const command = `powershell -ExecutionPolicy Bypass -Command "Import-Certificate -FilePath '${this.certPath}' -CertStoreLocation 'Cert:\\LocalMachine\\Root'"`;
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        console.log('简单PowerShell证书导入输出:', stdout);
        console.log('简单PowerShell证书导入错误:', stderr);
        
        if (error) {
          resolve({ success: false, error: `简单PowerShell命令执行失败: ${error.message}` });
        } else {
          resolve({ success: true, message: '证书导入成功 (简单PowerShell)' });
        }
      });
    });
  }

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
}

module.exports = CertificateManager;
