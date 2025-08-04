const fs = require('fs');
const path = require('path');

flipbooksPath = 'D:/Up366StudentFiles/flipbooks/'
innerPath = '/bookres/media/'
choosePath = ''

targetFolder = flipbooksPath + choosePath + innerPath

// 检查目标文件夹是否存在
if (!fs.existsSync(targetFolder)) {
  console.log('路径不存在');
  process.exit(1);
}

// 指定音频文件路径
const specificAudio = './init.mp3';

// 检查音频文件是否存在
if (!fs.existsSync(specificAudio)) {
  console.log('文件不存在');
  process.exit(1);
}

// 递归查找并替换MP3文件
replaceMp3Files(targetFolder, specificAudio)
  .then(() => {
    console.log('所有音频已替换完成');
  })
  .catch(err => {
    console.error('Error:', err);
  });

递归查找并还原MP3文件
restoreMp3Files(targetFolder, specificAudio)
 .then(() => {
   console.log('所有音频已还原完成');
 })
 .catch(err => {
   console.error('Error:', err);
 });

async function replaceMp3Files(folder, audioFile) {
  const files = await fs.promises.readdir(folder, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(folder, file.name);

    if (file.isDirectory()) {
      await replaceMp3Files(fullPath, audioFile);
    } else if (file.isFile() && path.extname(file.name).toLowerCase() === '.mp3') {
      const newPath = path.join(folder, file.name);
      const backupsPath = path.join(folder, file.name+'_1');
      await fs.promises.copyFile(newPath, backupsPath);
      await fs.promises.copyFile(audioFile, newPath);
      console.log(`${fullPath}替换成功`);
    }
  }
}


async function restoreMp3Files(folder, audioFile) {
  const files = await fs.promises.readdir(folder, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(folder, file.name);

    if (file.isDirectory()) {
      await restoreMp3Files(fullPath, audioFile);
    } else if (file.isFile() && path.extname(file.name).toLowerCase() === '.mp3_1') {
      const backupsPath = path.join(folder, file.name);
      const oldPath = path.join(folder, file.name.replace('_1', ''));
      await fs.promises.copyFile(backupsPath, oldPath);
      await fs.unlink(backupsPath, () => {})
      console.log(`${fullPath}还原成功`);
    }
  }
}