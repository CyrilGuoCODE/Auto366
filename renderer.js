document.addEventListener('DOMContentLoaded', () => {
    const firstCheckBtn = document.getElementById('firstCheck')
    const secondCheckBtn = document.getElementById('secondCheck')
    const resultDiv = document.getElementById('result')

    let initialFiles = []

    firstCheckBtn.addEventListener('click', async () => {
        initialFiles = window.electronAPI.checkFirst()

        if (initialFiles === null) {
            resultDiv.innerHTML = '<span class="error">资源路径不存在: D:/Up366StudentFiles/resources/</span>'
            return
        }

        resultDiv.innerHTML = `
            <strong>首次检测完成！</strong><br>
            当前资源目录包含 ${initialFiles.length} 个文件<br>
            <br>
            <strong>下一步：</strong><br>
            1. 清理资源目录（如果有文件请点击"删除已下载"按钮清理资源目录（必须））<br>
            2. 在天学网中找到并下载一个未下载的练习<br>
            3. 确保下载完成后，点击"再次检测"按钮
        `
        secondCheckBtn.disabled = false
        firstCheckBtn.disabled = true
    })

    secondCheckBtn.addEventListener('click', () => {
        const result = window.electronAPI.checkSecond(initialFiles)

        if (result.error) {
            resultDiv.innerHTML = `<span class="error">${result.error}</span>`
        } else {
            resultDiv.innerHTML = `
                <strong>再次检测完成！</strong><br>
                检测到 ${result.answer.length} 个答案<br>
                <br>
                <strong>答案列表：</strong><br>
                ${result.answer.map((ans, index) => `${index + 1}. ${ans}`).join('<br>')}
                <br>
                <br>
                <strong>下一步：</strong><br>
                点击"定位填充数据"按钮，在练习页面中设置坐标
            `
        }

        // 重置按钮状态
        secondCheckBtn.disabled = true
        firstCheckBtn.disabled = false
    })
})
document.getElementById('locationBtn').addEventListener('click', () => {
  window.electronAPI.openLocationWindow();
});

window.electronAPI.updateLocations((event, locations) => {
  const display = `
    <strong>坐标设置完成！</strong><br>
    🔴 输入框位置: (${locations.pos1.x}, ${locations.pos1.y})<br>
    🔵 下一页按钮位置: (${locations.pos2.x}, ${locations.pos2.y})<br>
    <br>
    <strong>下一步：</strong><br>
    点击"开始填充数据"按钮开始自动填写
  `;
  document.getElementById('locationData').innerHTML = display;
  document.getElementById('startBtn').disabled = false
});

document.getElementById('startBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `
    <strong>🔄 正在执行自动填充...</strong><br>
    ⏳ 请稍候，不要移动鼠标或切换窗口
  `;
  window.electronAPI.startPoint();
});

// 监听操作完成事件
window.electronAPI.onOperationComplete((event, result) => {
  const resultDiv = document.getElementById('result');
  if (result.success) {
    resultDiv.innerHTML = `
      <strong>自动填充完成！</strong><br>
      所有答案已成功填写并翻页<br>
      <br>
      <strong>可以开始新的练习：</strong><br>
      1. 重新点击"首次检测"按钮<br>
      2. 下载新的练习<br>
      3. 重复上述流程
    `;
  } else {
    resultDiv.innerHTML = `
      <strong>操作失败</strong><br>
      错误信息: ${result.error}<br>
      <br>
    `;
  }
});

document.getElementById('deleteBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('result');

     if (confirm('警告：此操作将删除 D:/Up366StudentFiles/resources/ 目录下的所有文件！\n\n注意：将保留名为 1944930808082993236 的文件夹\n\n确定要继续吗？')) {
    resultDiv.innerHTML = `
      <strong>正在删除文件...</strong><br>
      请稍候
    `;
    
    const result = window.electronAPI.deleteAllFiles();
    
    if (result.error) {
      resultDiv.innerHTML = `
        <strong>删除失败</strong><br>
        错误信息: ${result.error}
      `;
    } else {
      resultDiv.innerHTML = `
        <strong>删除成功！</strong><br>
        已删除 ${result.deletedCount} 个文件/目录<br>
        <br>
        <strong>现在可以：</strong><br>
        1. 点击"首次检测"按钮<br>
        2. 下载新的练习
        3. 点击再次检测按钮
      `;
    }
  }
});

