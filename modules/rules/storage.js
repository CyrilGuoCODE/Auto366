const moduleLog = require('../logging').create('规则');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { dialog } = require('electron');

function generateId(name) {
  return crypto.createHash('md5').update(name).digest('hex');
}

module.exports = {
migrateMaxTriggers(appPath) {
    if (this.loadError) return;
    const APP_VERSION = '1.0.0-maxTriggers-fix';
    const configPath = path.join(appPath, 'temp', '.migration');
    let done = false;
    try {
      if (fs.existsSync(configPath)) {
        done = fs.readFileSync(configPath, 'utf-8').trim() === APP_VERSION;
      }
    } catch (e) {}

    if (done) return;

    let migrated = false;
    // Failed persistence must not halve the in-memory counters again on retry.
    const rulesets = JSON.parse(JSON.stringify(this.getRules()));
    for (const ruleset of rulesets) {
      for (const rule of ruleset.rules) {
        if (rule.type === 'zip-implant' && rule.maxTriggers !== undefined && rule.maxTriggers > 0) {
          rule.maxTriggers = Math.ceil(rule.maxTriggers / 3);
          rule.currentTriggers = Math.floor((rule.currentTriggers || 0) / 3);
          migrated = true;
        }
      }
    }
    if (migrated) {
      if (!this.saveRules(rulesets)) return;
    }

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(configPath, APP_VERSION, 'utf-8');
    } catch (e) {}
  },


ensureRulesDirectory() {
    if (!fs.existsSync(this.rulesDir)) {
      fs.mkdirSync(this.rulesDir, { recursive: true });
    }
  },

migrateFromOldFormat(oldRules) {
    // 使用与 saveRule 一致的逻辑判断规则集：isGroup=true 或 (无type且无groupId)
    const isRuleset = (item) => item.isGroup || (!item.type && !item.groupId);

    const groups = oldRules.filter(r => isRuleset(r));
    const rules = oldRules.filter(r => !isRuleset(r));

    const assignedRuleIds = new Set();

    const result = groups.map(group => {
      const groupRules = rules.filter(r => r.groupId === group.id);
      groupRules.forEach(r => assignedRuleIds.add(r.id));

      const { isGroup, groupId, ...rulesetData } = group;

      // 根据是否包含注入规则计算 compatible
      const hasInjectionRules = groupRules.some(r =>
        r.type === 'zip-implant' || r.type === 'zip-implant-dynamic'
      );
      const autoCompatible = !hasInjectionRules;
      const compatible = rulesetData.compatible !== undefined
        ? rulesetData.compatible
        : autoCompatible;

      const ruleset = {
        ...rulesetData,
        id: group.name ? generateId(group.name) : group.id,
        compatible,
        createdAt: rulesetData.createdAt || new Date().toISOString(),
        updatedAt: rulesetData.updatedAt || new Date().toISOString(),
        rules: groupRules.map(rule => {
          const { groupId: gId, isGroup: isGrp, ...ruleData } = rule;
          return {
            ...ruleData,
            id: rule.name ? generateId(rule.name) : rule.id
          };
        })
      };
      return ruleset;
    });

    // 孤儿规则：有 groupId 但对应分组不存在，或无 groupId 的独立规则
    const independentRules = rules.filter(r => !assignedRuleIds.has(r.id));
    if (independentRules.length > 0) {
      result.push({
        id: generateId('独立规则'),
        name: '独立规则',
        description: '从旧版本迁移的独立规则',
        enabled: true,
        compatible: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rules: independentRules.map(rule => {
          const { groupId, isGroup, ...ruleData } = rule;
          return {
            ...ruleData,
            id: rule.name ? generateId(rule.name) : rule.id
          };
        })
      });
    }

    return result;
  },

loadRules() {
    this.loadError = null;
    try {
      this.ensureRulesDirectory();

      if (fs.existsSync(this.rulesFile)) {
        const content = fs.readFileSync(this.rulesFile, 'utf-8');
        const data = JSON.parse(content);

        if (!Array.isArray(data)) {
          throw new Error('规则文件必须是数组');
        }

        if (data.length > 0 && data.some(item => item.isGroup !== undefined || item.groupId !== undefined)) {
          this.rulesets = this.migrateFromOldFormat(data);
          this.saveRules();
        } else if (data.length > 0 && data[0].rules !== undefined) {
          this.rulesets = data;
        } else if (data.length === 0) {
          this.rulesets = [];
        } else {
          this.rulesets = this.migrateFromOldFormat(data);
          this.saveRules();
        }
      } else {
        this.rulesets = [];
      }
    } catch (error) {
      this.loadError = error;
      moduleLog.error('加载规则失败:', error);
      this.rulesets = [];
    }
  },

saveRules(rulesets = null) {
    try {
      if (this.loadError) throw new Error('原规则读取失败，已保留原文件：' + this.loadError.message);
      this.ensureRulesDirectory();
      const toSave = rulesets !== null ? rulesets : this.rulesets;
      if (fs.existsSync(this.rulesFile) && !fs.existsSync(this.rulesFile + '.bak')) {
        fs.copyFileSync(this.rulesFile, this.rulesFile + '.bak', fs.constants.COPYFILE_EXCL);
      }
      fs.writeFileSync(this.rulesFile + '.tmp', JSON.stringify(toSave, null, 2), 'utf-8');
      fs.renameSync(this.rulesFile + '.tmp', this.rulesFile);

      if (rulesets !== null) {
        this.rulesets = rulesets;
      }

      return true;
    } catch (error) {
      moduleLog.error('保存规则失败:', error);
      return false;
    }
  },

async importRules() {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const rulesFile = result.filePaths[0];
        const content = fs.readFileSync(rulesFile, 'utf-8');
        const importedData = JSON.parse(content);

        if (Array.isArray(importedData)) {
          let toImport;
          if (importedData.length > 0 && (importedData[0].isGroup !== undefined || importedData[0].groupId !== undefined)) {
            toImport = this.migrateFromOldFormat(importedData);
          } else if (importedData.length > 0 && importedData[0].rules !== undefined) {
            toImport = importedData;
          } else {
            toImport = importedData;
          }

          // 合并"独立规则"规则集，避免产生重复
          const independentId = generateId('独立规则');
          const existingIndependent = this.rulesets.find(rs => rs.id === independentId);
          const importedIndependent = toImport.find(rs => rs.id === independentId);
          const otherImported = toImport.filter(rs => rs.id !== independentId);

          if (importedIndependent) {
            if (existingIndependent) {
              // 合并到已有的独立规则集
              existingIndependent.rules = [...existingIndependent.rules, ...importedIndependent.rules];
              existingIndependent.updatedAt = new Date().toISOString();
              this.rulesets = [...this.rulesets, ...otherImported];
            } else {
              this.rulesets = [...this.rulesets, ...toImport];
            }
          } else {
            this.rulesets = [...this.rulesets, ...toImport];
          }

          if (!this.saveRules()) return { success: false, error: '规则未保存，请检查原文件和目录权限' };
          return { success: true, count: importedData.length };
        }
      }
      return { success: false, error: '未选择文件或文件格式不正确' };
    } catch (error) {
      moduleLog.error('导入规则失败:', error);
      return { success: false, error: error.message };
    }
  },

async exportRules() {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: 'rules.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });

      if (!result.canceled) {
        fs.writeFileSync(result.filePath, JSON.stringify(this.rulesets, null, 2), 'utf-8');
        return { success: true, path: result.filePath };
      }
      return { success: false, error: '未选择保存位置' };
    } catch (error) {
      moduleLog.error('导出规则失败:', error);
      return { success: false, error: error.message };
    }
  }
};
