const moduleLog = require('../logging').create('答案');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ipcMain = require('../register').forModule('answers');

module.exports = function register({ supabase, bucket = 'auto366-share' } = {}) {
  if (!supabase) {
    const { createClient } = require('@supabase/supabase-js');
    const SUPABASE_URL = 'https://myenzpblosjnrtvicdor.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZW56cGJsb3NqbnJ0dmljZG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NjAxMzAsImV4cCI6MjA4MzUzNjEzMH0.XkwQ72RmH8l1_krYc_IdPXsFk5pwL5JXQ3mDZ-ax3mU';
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
ipcMain.handle('share-answer-file', async (event, filePath) => {
      try {
        if (!fs.existsSync(filePath)) {
          return { success: false, error: '文件不存在' };
        }
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(fileName);
        const timestamp = Date.now();
        const randomId = uuidv4().substring(0, 8);
        const uniqueFileName = `${timestamp}_${randomId}${fileExtension}`;
        const fileBuffer = await fs.readFile(filePath);
        const { data, error } = await supabase.storage
          .from(bucket)
          .upload(uniqueFileName, fileBuffer, {
            contentType: 'application/json',
            upsert: false
          });
        if (error) {
          moduleLog.error('Supabase 上传错误:', error);
          return {
            success: false,
            error: `上传失败: ${error.message}`
          };
        }
        const { data: urlData } = supabase.storage
          .from(bucket)
          .getPublicUrl(uniqueFileName);
        if (!urlData || !urlData.publicUrl) {
          return {
            success: false,
            error: '获取下载链接失败'
          };
        }
        return {
          success: true,
          fileId: data.path,
          downloadUrl: urlData.publicUrl
        };
      } catch (error) {
        moduleLog.error('分享答案文件失败:', error);
        return {
          success: false,
          error: error.message || '上传失败'
        };
      }
    });

};
