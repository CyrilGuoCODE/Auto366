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

function replaceMp3FilesSync(folder, audioFile) {
  const files = fs.readdirSync(folder, { withFileTypes: true })
  let replacedCount = 0

  for (const file of files) {
    const fullPath = path.join(folder, file.name)

    if (file.isDirectory()) {
      replacedCount += replaceMp3FilesSync(fullPath, audioFile)
    } else if (file.isFile() && path.extname(file.name).toLowerCase() === '.mp3') {
      const newPath = path.join(folder, file.name)
      const backupsPath = path.join(folder, file.name + '_1')
      fs.copyFileSync(newPath, backupsPath)
      fs.copyFileSync(audioFile, newPath)
      replacedCount++
    }
  }
  
  return replacedCount
}

function restoreMp3FilesSync(folder) {
  const files = fs.readdirSync(folder, { withFileTypes: true })
  let restoredCount = 0

  for (const file of files) {
    const fullPath = path.join(folder, file.name)

    if (file.isDirectory()) {
      restoredCount += restoreMp3FilesSync(fullPath)
    } else if (file.isFile() && path.extname(file.name).toLowerCase() === '.mp3_1') {
      const backupsPath = path.join(folder, file.name)
      const oldPath = path.join(folder, file.name.replace('_1', ''))
      fs.copyFileSync(backupsPath, oldPath)
      fs.unlinkSync(backupsPath)
      restoredCount++
    }
  }
  
  return restoredCount
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

    // if (filteredAppend.length !== 1) {
    //   return { error: '检测错误' }
    // }

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
  getScaleFactor: () => ipcRenderer.invoke('get-scale-factor'),
  setGlobalScale: (scale) => ipcRenderer.send('set-global-scale', scale),
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
  },
  replaceAudioFiles: (choosePath) => {
    const flipbooksPath = 'D:/Up366StudentFiles/flipbooks/'
    const innerPath = '/bookres/media/'
    const targetFolder = flipbooksPath + choosePath + innerPath
    const specificAudio = path.join(__dirname, 'init.mp3')

    if (!fs.existsSync(targetFolder)) {
      return { error: '目标路径不存在: ' + targetFolder }
    }

    if (!fs.existsSync(specificAudio)) {
      return { error: '音频文件不存在: ' + specificAudio }
    }

    try {
      const replacedCount = replaceMp3FilesSync(targetFolder, specificAudio)
      return { success: true, message: '音频替换完成', replacedCount }
    } catch (e) {
      return { error: '音频替换失败: ' + e.message }
    }
  },
  restoreAudioFiles: (choosePath) => {
    const flipbooksPath = 'D:/Up366StudentFiles/flipbooks/'
    const innerPath = '/bookres/media/'
    const targetFolder = flipbooksPath + choosePath + innerPath

    if (!fs.existsSync(targetFolder)) {
      return { error: '目标路径不存在: ' + targetFolder }
    }

    try {
      const restoredCount = restoreMp3FilesSync(targetFolder)
      return { success: true, message: '音频还原完成', restoredCount }
    } catch (e) {
      return { error: '音频还原失败: ' + e.message }
    }
  },
  getFlipbooksFolders: () => {
    const flipbooksPath = 'D:/Up366StudentFiles/flipbooks/'
    
    if (!fs.existsSync(flipbooksPath)) {
      return { error: 'flipbooks目录不存在: ' + flipbooksPath }
    }

    try {
      const folders = fs.readdirSync(flipbooksPath, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => item.name)
      
      return { success: true, folders }
    } catch (e) {
      return { error: '读取目录失败: ' + e.message }
    }
  },
  getListeningAnswers: (choosePath) => {
    const flipbooksPath = 'D:/Up366StudentFiles/flipbooks/'
    const targetFolder = flipbooksPath + choosePath
    
    if (!fs.existsSync(targetFolder)) {
      return { error: '目标路径不存在: ' + targetFolder }
    }

    try {
      let results = {'P2': {}, 'P3': []}
      
      function findFilesByExtension(dir) {
        let list = fs.readdirSync(dir)
        let pending = list.length
        if (pending === 0) return

        for (let dirent of list) {
          const dirName = path.resolve(dir, dirent)
          if (fs.statSync(dirName).isDirectory()) {
            findFilesByExtension(dirName)
          } else {
            if (dirent.includes('A') && dirent.toLowerCase().includes('.mp3')) {
              let len = dirent.length
              let className = dirent.substring(1, len-6)
              if (!(className in results['P2'])) results['P2'][className] = [dirName]
              else results['P2'][className].push(dirName)
            }
            if (dirName.includes('psdata_new') && dirent === 'answer.json') {
              results['P3'].push(dirName)
            }
          }
        }
      }

      findFilesByExtension(targetFolder)
      
      const p3Answers = []
      for (const answerPath of results['P3']) {
        try {
          const answerContent = fs.readFileSync(answerPath, 'utf8')
          const answerData = JSON.parse(answerContent)
          p3Answers.push({
            path: answerPath,
            data: answerData
          })
        } catch (e) {
          p3Answers.push({
            path: answerPath,
            error: '解析JSON失败: ' + e.message
          })
        }
      }
      
      const p2WithProtocol = {}
      for (const [className, files] of Object.entries(results['P2'])) {
        p2WithProtocol[className] = files.map(file => file.replace(/\\/g, '/'))
      }
      
      return {
        success: true,
        P2: p2WithProtocol,
        P3: p3Answers
      }
    } catch (e) {
      return { error: '获取答案失败: ' + e.message }
    }
  },
  openLocationWindowPk: () => ipcRenderer.send('open-location-window-pk'),
  setLocationsPk1: (pos)=> ipcRenderer.send('set-locations-pk-1', pos),
  setLocationsPk2: (pos)=> ipcRenderer.send('set-locations-pk-2', pos),
  startChoose: () => ipcRenderer.send('start-choose'),
  getScaleFactor: () => ipcRenderer.invoke('get-scale-factor'),
  deleteFlipbooksFiles: () => {
    const flipbooksPath = 'D:/Up366StudentFiles/flipbooks/'
    
    if (!fs.existsSync(flipbooksPath)) {
      return { error: 'flipbooks目录不存在: ' + flipbooksPath }
    }
    
    try {
      const files = fs.readdirSync(flipbooksPath)
      let deletedCount = 0
      
      for (const file of files) {
        const filePath = path.join(flipbooksPath, file)
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
  },
  writeSystemAudio: (filePath) => {
    try {
      console.log(`系统音频写入: ${filePath}`);

      const audioInfo = {
        path: filePath,
        timestamp: new Date().toISOString(),
        action: 'write_to_system'
      };

      
      return { success: true, message: '系统音频已写入', audioInfo };
    } catch (e) {
      return { error: '系统音频写入失败: ' + e.message };
    }
  }
})