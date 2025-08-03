const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')

const resourcePath = 'D:/Up366StudentFiles/resources/'

function deleteDirectoryRecursively(dirPath) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath)
    
    for (const file of files) {
      const curPath = path.join(dirPath, file)
      const stats = fs.statSync(curPath)
      
      if (stats.isDirectory()) {
        deleteDirectoryRecursively(curPath)
      } else {
        fs.unlinkSync(curPath)
      }
    }
    
    fs.rmdirSync(dirPath)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  checkFirst: () => {
    if (!fs.existsSync(resourcePath)) return null
    return fs.readdirSync(resourcePath)
  },
  checkSecond: (initialFiles) => {
    const currentFiles = fs.readdirSync(resourcePath)
    const append = currentFiles.filter(file => !initialFiles.includes(file))

    // 过滤掉cache目录
    const filteredAppend = append.filter(file => file !== 'cache')

    if (filteredAppend.length !== 1) {
      return { error: '检测错误' }
    }

    const nPath = path.join(resourcePath, filteredAppend[0])
    const answer = []

    try {
      for (const item of fs.readdirSync(nPath)) {
        const dir = path.join(nPath, item)
        if (!fs.statSync(dir).isDirectory()) continue

        const subDir = path.join(dir, fs.readdirSync(dir)[0])
        const filename = fs.readdirSync(subDir)[0].replace('.mp3', '')
        const parts = filename.split('-')
        answer.push(parts[1])
      }

      const sortedAnswer = answer.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      ipcRenderer.send('set-answer', sortedAnswer)
      return { answer: sortedAnswer }
    } catch (e) {
      return { error: '处理文件时出错: ' + e.message }
    }
  },
  openLocationWindow: () => ipcRenderer.send('open-location-window'),
  setLocations: (locations) => ipcRenderer.send('set-locations', locations),
  updateLocations: (callback) => ipcRenderer.on('update-locations', callback),
  startPoint: () => ipcRenderer.send('start-point'),
  onOperationComplete: (callback) => ipcRenderer.on('operation-complete', callback),
     deleteAllFiles: () => {
     if (!fs.existsSync(resourcePath)) {
       return { error: '资源路径不存在' }
     }
     
     try {
       const files = fs.readdirSync(resourcePath)
       let deletedCount = 0
       
       for (const file of files) {
         // 跳过名为 1944930808082993236 的文件夹
         if (file === '1944930808082993236') {
           continue
         }
         
         const filePath = path.join(resourcePath, file)
         const stats = fs.statSync(filePath)
         
         if (stats.isDirectory()) {
           deleteDirectoryRecursively(filePath)
           deletedCount++
         } else {
           fs.unlinkSync(filePath)
           deletedCount++
         }
       }
       
       return { success: true, deletedCount }
     } catch (e) {
       return { error: '删除文件时出错: ' + e.message }
     }
   }
})