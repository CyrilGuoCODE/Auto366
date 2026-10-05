import settingsStorage from '../services/settings.js';

export default {
initResizer() {
    const resizer = document.getElementById('resizer');
    const leftContent = document.getElementById('leftContent');
    const rightLogs = document.getElementById('rightLogs');
    const contentArea = document.querySelector('.main__content');

    let isResizing = false;
    let startX = 0;
    let startLeftWidth = 0;

    // 从localStorage加载保存的宽度比例
    const savedLeftFlex = settingsStorage.getItem('leftContentFlex') || '2';
    const savedRightFlex = settingsStorage.getItem('rightLogsFlex') || '1';

    leftContent.style.flex = savedLeftFlex;
    rightLogs.style.flex = savedRightFlex;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;

      const leftRect = leftContent.getBoundingClientRect();

      startLeftWidth = leftRect.width;

      resizer.classList.add('is-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const contentAreaRect = contentArea.getBoundingClientRect();
      const totalWidth = contentAreaRect.width - 4;

      const newLeftWidth = Math.max(300, Math.min(startLeftWidth + deltaX, totalWidth - 250));
      const newRightWidth = totalWidth - newLeftWidth;

      const leftFlex = newLeftWidth / totalWidth * 3;
      const rightFlex = newRightWidth / totalWidth * 3;

      leftContent.style.flex = leftFlex.toString();
      rightLogs.style.flex = rightFlex.toString();
    });

    const finishResize = () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        settingsStorage.setItem('leftContentFlex', leftContent.style.flex);
        settingsStorage.setItem('rightLogsFlex', rightLogs.style.flex);
      }
    };

    document.addEventListener('mouseup', finishResize);
    document.addEventListener('mouseleave', finishResize);

    // 防止拖拽时选中文本
    resizer.addEventListener('selectstart', (e) => {
      e.preventDefault();
    });

    // 初始化详情面板拖动功能
    this.initDetailsResizer();
  },

initDetailsResizer() {
    const detailsResizer = document.getElementById('detailsResizer');
    const trafficMonitor = document.getElementById('trafficMonitor');
    const requestDetails = document.getElementById('requestDetails');
    const logsContainer = document.querySelector('.logs-container');

    let isDetailsResizing = false;
    let startX = 0;
    let startMonitorWidth = 0;

    if (!detailsResizer || !trafficMonitor || !requestDetails) return;

    detailsResizer.addEventListener('mousedown', (e) => {
      isDetailsResizing = true;
      startX = e.clientX;

      const monitorRect = trafficMonitor.getBoundingClientRect();

      startMonitorWidth = monitorRect.width;

      detailsResizer.classList.add('is-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDetailsResizing) return;

      const deltaX = e.clientX - startX;
      const containerRect = logsContainer.getBoundingClientRect();
      const totalWidth = containerRect.width - 4;

      const maxDetailsWidth = totalWidth * 0.5;
      const minDetailsWidth = 300;
      const minMonitorWidth = 200;

      let newMonitorWidth = startMonitorWidth + deltaX;
      let newDetailsWidth = totalWidth - newMonitorWidth;

      if (newDetailsWidth > maxDetailsWidth) {
        newDetailsWidth = maxDetailsWidth;
        newMonitorWidth = totalWidth - newDetailsWidth;
      }

      if (newDetailsWidth < minDetailsWidth) {
        newDetailsWidth = minDetailsWidth;
        newMonitorWidth = totalWidth - newDetailsWidth;
      }

      if (newMonitorWidth < minMonitorWidth) {
        newMonitorWidth = minMonitorWidth;
        newDetailsWidth = totalWidth - newMonitorWidth;
      }

      const monitorFlex = newMonitorWidth / totalWidth * 2;
      const detailsFlex = newDetailsWidth / totalWidth * 2;

      trafficMonitor.style.flex = monitorFlex.toString();
      requestDetails.style.flex = detailsFlex.toString();
    });

    const finishDetailsResize = () => {
      if (isDetailsResizing) {
        isDetailsResizing = false;
        detailsResizer.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        settingsStorage.setItem('trafficMonitorFlex', trafficMonitor.style.flex);
        settingsStorage.setItem('requestDetailsFlex', requestDetails.style.flex);
      }
    };

    document.addEventListener('mouseup', finishDetailsResize);
    document.addEventListener('mouseleave', finishDetailsResize);

    detailsResizer.addEventListener('selectstart', (e) => {
      e.preventDefault();
    });
  }
};
