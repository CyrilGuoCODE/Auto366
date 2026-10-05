const moduleLog = require('../logging').create('答案');
const registry = require('../register');

module.exports = function register({ files, windowManager }) {
    const exportPdf = async (e, htmlContent) => {
      try {
        if (!windowManager) {
          return { success: false, error: '窗口管理器未初始化' };
        }

        const pdfResult = await windowManager.exportHtmlToPdf(htmlContent);
        if (!pdfResult.success) {
          return { success: false, error: pdfResult.error };
        }

        const filePath = await files.saveFileDialog({
          defaultPath: `answers_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`,
          filters: [
            { name: 'PDF Files', extensions: ['pdf'] }
          ]
        });

        if (!filePath) {
          return { success: false, error: '用户取消保存' };
        }

        const writeOk = files.writeFile(filePath, pdfResult.pdfBuffer);
        if (!writeOk) {
          return { success: false, error: '写入 PDF 文件失败' };
        }

        return { success: true, filePath };
      } catch (error) {
        moduleLog.error('导出 PDF 失败:', error);
        return { success: false, error: error.message };
      }
    };
  registry.forModule('answers').handle('export-answers-pdf', exportPdf);
  // 兼容此前通用桥的 file 命名空间；业务实现只保留一处。
  registry.forModule('file', { legacy: false }).handle('export-answers-pdf', exportPdf);
};
