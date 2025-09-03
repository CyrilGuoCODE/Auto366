const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class CertificateManager {
  constructor() {
    this.certPath = path.join(os.homedir(), 'node-mitmproxy', 'node-mitmproxy.ca.crt');
    this.isImported = false;
  }

  async importCertificate() {
    try {
      if (!await this.certificateExists()) {
        console.log('证书文件不存在:', this.certPath);
        return { success: false, error: '证书文件不存在', status: 'not_found' };
      }

      if (await this.isCertificateAlreadyImported()) {
        console.log('证书已经导入到受信任的根证书颁发机构');
        this.isImported = true;
        return { success: true, message: '证书已经存在于受信任的根证书颁发机构', status: 'exists' };
      }

      const result = await this.addCertificateToStore();
      if (result.success) {
        this.isImported = true;
        console.log('证书导入成功');
        result.status = 'success';
      } else {
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
      const command = `powershell -Command "Get-ChildItem -Path 'Cert:\\LocalMachine\\Root' | Where-Object { $_.Subject -like '*node-mitmproxy*' } | Measure-Object | Select-Object -ExpandProperty Count"`;
      
      exec(command, (error, stdout) => {
        if (error) {
          resolve(false);
        } else {
          const count = parseInt(stdout.trim());
          resolve(count > 0);
        }
      });
    });
  }

  async addCertificateToStore() {
    return new Promise((resolve) => {
      const command = `powershell -Command "Import-Certificate -FilePath '${this.certPath}' -CertStoreLocation 'Cert:\\LocalMachine\\Root'"`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('证书导入命令执行失败:', error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true, message: '证书导入成功' });
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
          this.isImported = false;
          resolve({ success: true, message: '证书删除成功' });
        }
      });
    });
  }

  getCertificatePath() {
    return this.certPath;
  }

  isCertificateImported() {
    return this.isImported;
  }
}

module.exports = CertificateManager;
