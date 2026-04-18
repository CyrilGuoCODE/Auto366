const Modal = require('./modal');

class Confirm {
  static show(options) {
    const {
      title = '确认',
      message = '',
      confirmText = '确定',
      cancelText = '取消',
      onConfirm = () => {},
      onCancel = () => {}
    } = options;

    return Modal.show({
      title,
      content: `<p>${message}</p>`,
      buttons: [
        {
          text: cancelText,
          type: 'secondary',
          onClick: onCancel
        },
        {
          text: confirmText,
          type: 'primary',
          onClick: onConfirm
        }
      ]
    });
  }

  static delete(message, onConfirm, onCancel) {
    return this.show({
      title: '删除确认',
      message: message || '确定要删除吗？此操作不可撤销。',
      confirmText: '删除',
      cancelText: '取消',
      onConfirm,
      onCancel
    });
  }

  static warning(message, onConfirm, onCancel) {
    return this.show({
      title: '警告',
      message,
      confirmText: '确定',
      cancelText: '取消',
      onConfirm,
      onCancel
    });
  }
}

module.exports = Confirm;
