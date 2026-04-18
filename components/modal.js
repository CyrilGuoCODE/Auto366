class Modal {
  static show(options) {
    const {
      title = '提示',
      content = '',
      buttons = [
        {
          text: '确定',
          type: 'primary',
          onClick: () => {}
        }
      ],
      onClose = () => {}
    } = options;

    // 移除已存在的模态框
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    // 创建模态框HTML
    const modalHTML = `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close" onclick="Modal.hide()">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="modal-body">
            ${content}
          </div>
          <div class="modal-footer">
            ${buttons.map((button, index) => `
              <button class="${button.type || 'secondary'}-btn" data-index="${index}">
                ${button.text}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 绑定按钮事件
    const modal = document.querySelector('.modal-overlay');
    const footerButtons = modal.querySelectorAll('.modal-footer button');

    footerButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        const buttonConfig = buttons[index];
        if (buttonConfig.onClick) {
          buttonConfig.onClick();
        }
        Modal.hide();
        onClose();
      });
    });

    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        Modal.hide();
        onClose();
      }
    });

    // 按ESC键关闭
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        Modal.hide();
        onClose();
        document.removeEventListener('keydown', handleEscKey);
      }
    };

    document.addEventListener('keydown', handleEscKey);

    return modal;
  }

  static alert(message, callback) {
    return this.show({
      title: '提示',
      content: `<p>${message}</p>`,
      buttons: [
        {
          text: '确定',
          type: 'primary',
          onClick: callback
        }
      ]
    });
  }

  static confirm(message, onConfirm, onCancel) {
    return this.show({
      title: '确认',
      content: `<p>${message}</p>`,
      buttons: [
        {
          text: '取消',
          type: 'secondary',
          onClick: onCancel
        },
        {
          text: '确定',
          type: 'primary',
          onClick: onConfirm
        }
      ]
    });
  }

  static hide() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.remove();
    }
  }
}

module.exports = Modal;
