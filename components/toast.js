class Toast {
  static success(message, duration = 3000) {
    this.show(message, 'success', duration);
  }

  static error(message, duration = 5000) {
    this.show(message, 'error', duration);
  }

  static info(message, duration = 3000) {
    this.show(message, 'info', duration);
  }

  static show(message, type = 'info', duration = 3000) {
    // 移除现有的提示
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }

    // 创建提示HTML
    const toastHTML = `
      <div class="toast ${type}">
        <i class="bi bi-${type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : 'info-circle'}"></i>
        <span>${message}</span>
      </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', toastHTML);

    // 显示动画
    const toast = document.querySelector('.toast');
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // 自动隐藏
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);

    return toast;
  }
}

module.exports = Toast;
