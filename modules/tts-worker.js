/*
 * TTS Worker —— TTS 语音生成子进程
 * ------------------------------------------------------------
 * 运行在 child_process.fork() 子进程中，避免 CPU 密集型的
 * sherpa-onnx tts.generate() 阻塞 Electron 主进程。
 *
 * IPC 协议:
 *   主→子  { type: 'init',     modelDir }       初始化引擎
 *   子→主  { type: 'ready',    success }         引擎就绪
 *   主→子  { type: 'generate', id, text, index, cacheDir, voice, speed }
 *   子→主  { type: 'result',   id, index, filePath, error }
 *   子→主  { type: 'log',      message, logType }
 *   主→子  { type: 'shutdown' }                   关闭引擎并退出
 */

const path = require('path');
const fs = require('fs-extra');

const VOICE_MAP = {
  Jasper: 0,
  Bella: 1,
  Bruno: 2,
  Luna: 3,
  Hugo: 4,
  Rosie: 5,
  Leo: 6,
  Kiki: 7,
};

let tts = null;

// ---- WAV 构建 ----
function buildWavBuffer(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;

  const int16Samples = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const dataSize = int16Samples.length * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  Buffer.from(int16Samples.buffer, int16Samples.byteOffset, int16Samples.byteLength).copy(buffer, 44);
  return buffer;
}

// ---- 日志转发 ----
function sendLog(message, logType = 'info') {
  process.send({ type: 'log', message, logType });
}

// ---- 消息处理 ----
process.on('message', async (msg) => {
  const { type } = msg;

  // ---- 初始化引擎 ----
  if (type === 'init') {
    try {
      const { modelDir } = msg;

      if (!fs.existsSync(modelDir)) {
        process.send({ type: 'ready', success: false });
        sendLog('模型目录不存在: ' + modelDir, 'error');
        return;
      }

      const sherpa_onnx = require('sherpa-onnx-node');
      const config = {
        model: {
          kitten: {
            model: path.join(modelDir, 'model.int8.onnx'),
            voices: path.join(modelDir, 'voices.bin'),
            tokens: path.join(modelDir, 'tokens.txt'),
            dataDir: path.join(modelDir, 'espeak-ng-data'),
          },
          debug: false, numThreads: 1, provider: 'cpu',
        },
        maxNumSentences: 1,
      };

      tts = new sherpa_onnx.OfflineTts(config);
      process.send({ type: 'ready', success: true });
      sendLog('引擎加载完成 (' + tts.numSpeakers + ' 种音色)', 'success');
    } catch (error) {
      process.send({ type: 'ready', success: false });
      sendLog('引擎加载失败: ' + error.message, 'error');
    }
    return;
  }

  // ---- 生成音频 ----
  if (type === 'generate') {
    const { id, text, index, cacheDir, voice, speed } = msg;

    try {
      if (!tts) {
        process.send({ type: 'result', id, index, filePath: null, error: '引擎未初始化' });
        return;
      }

      // 文本清理
      const cleanText = text.replace(/<[^>]*>/g, '').replace(/[<>{}[\]\\]/g, '').trim();
      if (!cleanText) {
        process.send({ type: 'result', id, index, filePath: null, error: null });
        return;
      }

      const sid = VOICE_MAP[voice] || 0;
      const audio = tts.generate({
        text: cleanText,
        sid: sid,
        speed: speed,
        enableExternalBuffer: false,  // Electron >=21 兼容性要求
      });

      const wavBuffer = buildWavBuffer(audio.samples, audio.sampleRate);

      // 写入磁盘
      const filePath = path.join(cacheDir, `${index}.wav`);
      fs.writeFileSync(filePath, wavBuffer);

      process.send({ type: 'result', id, index, filePath, error: null });
    } catch (error) {
      sendLog('生成失败: ' + error.message, 'error');
      process.send({ type: 'result', id, index, filePath: null, error: error.message });
    }
    return;
  }

  // ---- 关闭引擎并退出 ----
  if (type === 'shutdown') {
    try {
      if (tts && typeof tts.free === 'function') tts.free();
    } catch (e) { /* 忽略 */ }
    tts = null;
    process.exit(0);
  }
});

// ---- 未捕获异常处理 ----
process.on('uncaughtException', (error) => {
  sendLog('子进程异常: ' + error.message, 'error');
  try {
    if (tts && typeof tts.free === 'function') tts.free();
  } catch (e) { /* 忽略 */ }
  process.exit(1);
});
