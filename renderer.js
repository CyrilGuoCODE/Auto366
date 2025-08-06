function showFeature(feature) {
    document.getElementById('main-menu').style.display = 'none';
    document.querySelectorAll('.content-area').forEach(area => {
        area.classList.remove('active');
    });
    document.getElementById(feature + '-content').classList.add('active');
}

function showMainMenu() {
    document.getElementById('main-menu').style.display = 'block';
    document.querySelectorAll('.content-area').forEach(area => {
        area.classList.remove('active');
    });
}

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
    <strong>正在执行自动填充...</strong><br>
    请稍候，不要移动鼠标或切换窗口
  `;
  window.electronAPI.startPoint();
});

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

document.getElementById('findPathBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('replaceResult');
  const folderPathInput = document.getElementById('folderPath');
  
  resultDiv.innerHTML = `
    <strong>正在寻找可用路径...</strong><br>
    请稍候
  `;
  
  const result = window.electronAPI.getFlipbooksFolders();
  
  if (result.error) {
    resultDiv.innerHTML = `
      <strong>寻找失败</strong><br>
      错误信息: ${result.error}
    `;
  } else {
    if (result.folders.length === 0) {
      resultDiv.innerHTML = `
        <strong>未找到可用路径</strong><br>
        flipbooks目录下没有找到任何文件夹
      `;
    } else if (result.folders.length === 1) {
      folderPathInput.value = result.folders[0];
      resultDiv.innerHTML = `
        <strong>自动填写完成！</strong><br>
        找到1个文件夹：${result.folders[0]}<br>
        已自动填写到输入框中
      `;
    } else {
      resultDiv.innerHTML = `
        <strong>找到多个文件夹</strong><br>
        请从以下列表中选择一个：<br>
        ${result.folders.map(folder => `• ${folder}`).join('<br>')}<br>
        <br>
        请手动输入要使用的文件夹路径
      `;
    }
  }
});

document.getElementById('findAnswerPathBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('answerResult');
  const folderPathInput = document.getElementById('answerFolderPath');
  
  resultDiv.innerHTML = `
    <strong>正在寻找可用路径...</strong><br>
    请稍候
  `;
  
  const result = window.electronAPI.getFlipbooksFolders();
  
  if (result.error) {
    resultDiv.innerHTML = `
      <strong>寻找失败</strong><br>
      错误信息: ${result.error}
    `;
  } else {
    if (result.folders.length === 0) {
      resultDiv.innerHTML = `
        <strong>未找到可用路径</strong><br>
        flipbooks目录下没有找到任何文件夹
      `;
    } else if (result.folders.length === 1) {
      folderPathInput.value = result.folders[0];
      resultDiv.innerHTML = `
        <strong>自动填写完成！</strong><br>
        找到1个文件夹：${result.folders[0]}<br>
        已自动填写到输入框中
      `;
    } else {
      resultDiv.innerHTML = `
        <strong>找到多个文件夹</strong><br>
        请从以下列表中选择一个：<br>
        ${result.folders.map(folder => `• ${folder}`).join('<br>')}<br>
        <br>
        请手动输入要使用的文件夹路径
      `;
    }
  }
});

document.getElementById('getAnswerBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('answerResult');
  const folderPath = document.getElementById('answerFolderPath').value.trim();
  
  if (!folderPath) {
    resultDiv.innerHTML = `
      <strong>错误</strong><br>
      请输入文件夹路径
    `;
    return;
  }
  
  resultDiv.innerHTML = `
    <strong>正在获取听力答案...</strong><br>
    请稍候
  `;
  
  const result = window.electronAPI.getListeningAnswers(folderPath);
  
  if (result.error) {
    resultDiv.innerHTML = `
      <strong>获取失败</strong><br>
      错误信息: ${result.error}
    `;
  } else {
    let p2Content = ''
    if (Object.keys(result.P2).length > 0) {
      p2Content = '<strong>P2听后回答 - 音频标答文件：</strong><br>'
      for (const [className, files] of Object.entries(result.P2)) {
        p2Content += `<strong>${className}：</strong><br>`
        files.forEach((file, index) => {
          const audioId = `audio_${className}_${index}`
          p2Content += `
            <div style="margin: 10px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
              <div style="margin-bottom: 10px; font-weight: bold; color: #333;">音频 ${index + 1}：</div>
              <audio id="${audioId}" controls style="width: 100%; max-width: 500px; height: 40px; border-radius: 6px; background: #fff;">
                <source src="file:///${file}" type="audio/mpeg">
                您的浏览器不支持音频播放
              </audio>
              <div style="margin-top: 10px; font-size: 11px; color: #888; word-wrap: break-word; word-break: break-all; line-height: 1.4; background: #f5f5f5; padding: 8px; border-radius: 4px; border-left: 3px solid #007bff;">${file}</div>
            </div>
          `
        })
        p2Content += '<br>'
      }
    } else {
      p2Content = '<strong>P2听后回答 - 音频标答文件：</strong> 未找到音频文件<br><br>'
    }
    
    let p3Content = ''
    if (result.P3.length > 0) {
      p3Content = '<strong>P3听后转述 - 听力标答：</strong><br>'
      result.P3.forEach((item, index) => {
        p3Content += `<strong>答案文件 ${index + 1}：</strong><br>`
        p3Content += `<div style="font-size: 11px; color: #888; word-wrap: break-word; word-break: break-all; line-height: 1.4; background: #f5f5f5; padding: 8px; border-radius: 4px; border-left: 3px solid #28a745; margin: 5px 0;">${item.path}</div>`
        if (item.error) {
          p3Content += `<div style="color: #dc3545; margin: 5px 0;">错误: ${item.error}</div>`
        } else {
          if (item.data.Data.OriginalStandard) {
		    p3Content += `
			  <div style="margin: 10px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
			    <div style="margin-bottom: 10px; font-weight: bold; color: #333;">听力音频：</div>
		    `
			item.data.Data.OriginalStandard.forEach((item1, index) => {
				p3Content += `<p>${item1}</p>`
			})
		    p3Content += `
			  </div>
		    `
          }
          if (item.data.Data.OriginalReference) {
		    p3Content += `
			  <div style="margin: 10px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa;">
			    <div style="margin-bottom: 10px; font-weight: bold; color: #333;">参考答案：</div>
		    `
			item.data.Data.OriginalReference.forEach((item1, index) => {
				p3Content += `<p>${item1}</p>`
			})
		    p3Content += `
			  </div>
		    `
          }
        }
        p3Content += '<br>'
      })
    } else {
      p3Content = '<strong>P3听后转述 - 听力标答：</strong> 未找到听力标答文件<br>'
    }
    
    resultDiv.innerHTML = `
      <strong>获取成功！</strong><br>
      已找到听力答案数据<br><br>
      ${p2Content}
      ${p3Content}
    `;
  }
});

document.getElementById('replaceBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('replaceResult');
  const folderPath = document.getElementById('folderPath').value.trim();
  
  if (!folderPath) {
    resultDiv.innerHTML = `
      <strong>错误</strong><br>
      请输入文件夹路径
    `;
    return;
  }
  
  if (confirm(`警告：此操作将替换 D:/Up366StudentFiles/flipbooks/${folderPath}/bookres/media/ 目录下的所有MP3文件！\n\n确定要继续吗？`)) {
    resultDiv.innerHTML = `
      <strong>正在替换音频文件...</strong><br>
      请稍候
    `;
    
    const result = window.electronAPI.replaceAudioFiles(folderPath);
    
    if (result.error) {
      resultDiv.innerHTML = `
        <strong>替换失败</strong><br>
        错误信息: ${result.error}
      `;
    } else {
      resultDiv.innerHTML = `
        <strong>替换成功！</strong><br>
        已替换 ${result.replacedCount} 个音频文件<br>
        <br>
        <strong>现在可以：</strong><br>
        1. 进行听力练习<br>
        2. 完成后点击"还原音频"按钮恢复原文件
      `;
    }
  }
});

document.getElementById('restoreBtn').addEventListener('click', () => {
  const resultDiv = document.getElementById('replaceResult');
  const folderPath = document.getElementById('folderPath').value.trim();
  
  if (!folderPath) {
    resultDiv.innerHTML = `
      <strong>错误</strong><br>
      请输入文件夹路径
    `;
    return;
  }
  
  if (confirm(`确定要还原 D:/Up366StudentFiles/flipbooks/${folderPath}/bookres/media/ 目录下的音频文件吗？`)) {
    resultDiv.innerHTML = `
      <strong>正在还原音频文件...</strong><br>
      请稍候
    `;
    
    const result = window.electronAPI.restoreAudioFiles(folderPath);
    
    if (result.error) {
      resultDiv.innerHTML = `
        <strong>还原失败</strong><br>
        错误信息: ${result.error}
      `;
    } else {
      resultDiv.innerHTML = `
        <strong>还原成功！</strong><br>
        已还原 ${result.restoredCount} 个音频文件<br>
        <br>
        <strong>操作完成</strong>
      `;
    }
  }
});

let pkStep = 1

function updatePkStepGuide(step) {
  const guide = document.getElementById('pk-step-guide')
  if (!guide) return
  if (step === 1) {
    guide.innerHTML = '<strong>第一步：</strong>请确保屏幕缩放为100%，否则自动选择可能会出现偏差(很重要)'
  } else if (step === 2) {
    guide.innerHTML = '<strong>第二步：</strong>点击“设置截图位置”按钮，按提示完成截图区域设置，然后点击“开始自动选择”按钮'
  } else if (step === 3) {
    guide.innerHTML = '<strong>第三步：</strong>程序正在自动选择，请勿操作鼠标和键盘，等待完成提示'
  }
}

document.getElementById('locationBtn-pk').addEventListener('click', () => {
  window.electronAPI.openLocationWindowPk();
  pkStep = 2
  setTimeout(() => updatePkStepGuide(pkStep), 300)
});

document.getElementById('startBtn-pk').addEventListener('click', () => {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `
    <strong>正在执行自动选择...</strong><br>
    请稍候，不要移动鼠标或切换窗口
    <span id="pk-step-guide"></span>
  `;
  pkStep = 3
  setTimeout(() => updatePkStepGuide(pkStep), 300)
  window.electronAPI.startChoose();
});

// 页面加载时初始化分步引导
if (document.getElementById('pk-step-guide')) {
  updatePkStepGuide(1)
}