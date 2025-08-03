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

        resultDiv.textContent = '首次检测完成，请点击"再次检测"按钮'
        secondCheckBtn.disabled = false
        firstCheckBtn.disabled = true
    })

    secondCheckBtn.addEventListener('click', () => {
        const result = window.electronAPI.checkSecond(initialFiles)

        if (result.error) {
            resultDiv.innerHTML = `<span class="error">${result.error}</span>`
        } else {
            resultDiv.textContent = `检测结果:\n${result.answer.join('\n')}`
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
  const display = `位置1: (${locations.pos1.x}, ${locations.pos1.y})<br>
                  位置2: (${locations.pos2.x}, ${locations.pos2.y})`;
  document.getElementById('locationData').innerHTML = display;
  document.getElementById('startBtn').disabled = false
});

document.getElementById('startBtn').addEventListener('click', () => {
  window.electronAPI.startPoint();
});

