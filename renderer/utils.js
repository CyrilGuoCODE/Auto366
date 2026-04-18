class Utils {
  // 格式化文件大小
  static formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  }

  // 格式化请求/响应体
  static formatBody(body, fullDisplay = false) {
    if (!body) return '';

    try {
      if (typeof body === 'string') {
        // 尝试解析JSON
        try {
          const parsed = JSON.parse(body);
          const jsonStr = JSON.stringify(parsed, null, 2);
          return fullDisplay ? jsonStr : jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
        } catch (e) {
          // 不是JSON，直接返回字符串
          return fullDisplay ? body : body.substring(0, 200) + (body.length > 200 ? '...' : '');
        }
      } else if (typeof body === 'object') {
        const jsonStr = JSON.stringify(body, null, 2);
        return fullDisplay ? jsonStr : jsonStr.substring(0, 200) + (jsonStr.length > 200 ? '...' : '');
      }
    } catch (e) {
      // 如果不是JSON，直接返回字符串的前200个字符
      const str = body.toString();
      return fullDisplay ? str : str.substring(0, 200) + (str.length > 200 ? '...' : '');
    }

    const str = body.toString();
    return fullDisplay ? str : str.substring(0, 200) + (str.length > 200 ? '...' : '');
  }

  // 格式化URL，确保显示完整URL
  static formatUrl(url) {
    if (!url) return '';

    // 如果URL太长，显示域名和路径的关键部分
    if (url.length > 80) {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const path = urlObj.pathname;
        const query = urlObj.search;

        if (path.length > 40) {
          const pathParts = path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          return `${domain}/.../${fileName}${query}`;
        }

        return `${domain}${path}${query}`;
      } catch (e) {
        return url.substring(0, 80) + '...';
      }
    }

    return url;
  }

  // 格式化请求头/响应头
  static formatHeaders(headers) {
    if (!headers) return '';

    if (typeof headers === 'object') {
      return JSON.stringify(headers, null, 2);
    }

    return headers.toString();
  }

  // 转义HTML特殊字符
  static escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 获取文件图标
  static getFileIcon(fileType) {
    const iconMap = {
      'json': 'bi-filetype-json',
      'zip': 'bi-filetype-zip',
      'js': 'bi-filetype-js',
      'md': 'bi-filetype-md',
      'txt': 'bi-filetype-txt'
    };
    return iconMap[fileType] || 'bi-file';
  }

  // 格式化文件结构
  static formatFileStructure(structure, depth = 0) {
    const indent = '  '.repeat(depth);
    let result = '';

    structure.forEach(item => {
      if (item.type === 'directory') {
        result += `${indent}📁 ${item.name}\n`;
        if (item.children) {
          result += this.formatFileStructure(item.children, depth + 1);
        }
      } else {
        result += `${indent}📄 ${item.name}\n`;
      }
    });

    return result;
  }
}

export default Utils;
