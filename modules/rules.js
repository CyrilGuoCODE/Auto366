const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { ipcMain, dialog } = require('electron');

function generateId(name) {
  return crypto.createHash('md5').update(name).digest('hex');
}

class RulesManager {
  constructor() {
    this.rulesDir = path.join(os.homedir(), '.Auto366', 'rules');
    this.rulesFile = path.join(this.rulesDir, 'rules.json');
    this.rulesets = [];
    this.loadRules();
  }

  ensureRulesDirectory() {
    if (!fs.existsSync(this.rulesDir)) {
      fs.mkdirSync(this.rulesDir, { recursive: true });
    }
  }

  migrateFromOldFormat(oldRules) {
    const groups = oldRules.filter(r => r.isGroup);
    const rules = oldRules.filter(r => !r.isGroup);

    const result = groups.map(group => {
      const groupRules = rules.filter(r => r.groupId === group.id);
      const { isGroup, groupId, ...rulesetData } = group;
      const ruleset = {
        ...rulesetData,
        id: group.name ? generateId(group.name) : group.id,
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

    const independentRules = rules.filter(r => !r.groupId);
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
  }

  loadRules() {
    try {
      this.ensureRulesDirectory();

      if (fs.existsSync(this.rulesFile)) {
        const content = fs.readFileSync(this.rulesFile, 'utf-8');
        const data = JSON.parse(content);

        if (!Array.isArray(data)) {
          this.rulesets = [];
          return;
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
      console.error('加载规则失败:', error);
      this.rulesets = [];
    }
  }

  saveRules(rulesets = null) {
    try {
      this.ensureRulesDirectory();
      const toSave = rulesets !== null ? rulesets : this.rulesets;
      fs.writeFileSync(this.rulesFile, JSON.stringify(toSave, null, 2), 'utf-8');

      if (rulesets !== null) {
        this.rulesets = rulesets;
      }

      return true;
    } catch (error) {
      console.error('保存规则失败:', error);
      return false;
    }
  }

  getRules() {
    return this.rulesets;
  }

  getRulesetById(rulesetId) {
    return this.rulesets.find(rs => rs.id === rulesetId);
  }

  findRuleById(ruleId, rulesetId = null) {
    if (rulesetId) {
      const rs = this.rulesets.find(rs => rs.id === rulesetId);
      if (!rs) return null;
      const rule = rs.rules.find(r => r.id === ruleId);
      return rule ? { ruleset: rs, rule } : null;
    }
    for (const rs of this.rulesets) {
      const rule = rs.rules.find(r => r.id === ruleId);
      if (rule) return { ruleset: rs, rule };
    }
    return null;
  }

  saveRule(rule) {
    try {
      const isRuleset = rule.isGroup || (!rule.type && !rule.groupId);

      if (isRuleset) {
        return this._saveRuleset(rule);
      } else {
        return this._saveRuleItem(rule);
      }
    } catch (error) {
      console.error('保存规则失败:', error);
      return false;
    }
  }

  _saveRuleset(ruleset) {
    try {
      if (!ruleset.name) return false;

      const existingIndex = this.rulesets.findIndex(rs => rs.id === ruleset.id);

      if (existingIndex !== -1) {
        const existing = this.rulesets[existingIndex];
        const newName = ruleset.name;
        const newId = generateId(newName);

        const nameConflict = this.rulesets.find(rs =>
          rs.id !== existing.id && rs.name === newName
        );
        if (nameConflict) {
          console.error('规则集名称已存在:', newName);
          return false;
        }

        const updated = {
          ...existing,
          ...ruleset,
          id: newId,
          updatedAt: new Date().toISOString()
        };
        delete updated.isGroup;
        delete updated.rules;

        updated.rules = existing.rules || [];

        this.rulesets[existingIndex] = updated;
      } else {
        const nameConflict = this.rulesets.find(rs => rs.name === ruleset.name);
        if (nameConflict) {
          console.error('规则集名称已存在:', ruleset.name);
          return false;
        }

        const newRuleset = {
          ...ruleset,
          id: generateId(ruleset.name),
          createdAt: ruleset.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          rules: []
        };
        delete newRuleset.isGroup;
        this.rulesets.push(newRuleset);
      }

      return this.saveRules();
    } catch (error) {
      console.error('保存规则集失败:', error);
      return false;
    }
  }

  _saveRuleItem(rule) {
    try {
      const rulesetId = rule.groupId;
      if (!rulesetId) {
        console.error('规则缺少所属规则集ID');
        return false;
      }

      const ruleset = this.getRulesetById(rulesetId);
      if (!ruleset) {
        console.error('未找到所属规则集:', rulesetId);
        return false;
      }

      if (!rule.name) return false;

      const existingIndex = ruleset.rules.findIndex(r => r.id === rule.id);

      const COMMON_FIELDS = new Set(['id', 'name', 'type', 'description', 'enabled', 'isBuiltin', 'createdAt', 'updatedAt', 'maxTriggers', 'currentTriggers']);
      const TYPE_FIELDS = {
        'content-change': ['urlPattern', 'changeType', 'originalContent', 'newContent', 'action', 'modifyRules'],
        'zip-implant': ['urlFileinfo', 'urlZip', 'targetFileName', 'zipImplant'],
        'zip-implant-dynamic': ['urlFileinfo', 'urlZip', 'targetFileName', 'injectScript', 'downloadTimeout'],
        'answer-upload': ['urlUpload', 'uploadType', 'serverLocate'],
        'post-change-time': ['urlRequest', 'salt', 'targetSeconds', 'method']
      };

      if (existingIndex !== -1) {
        const newName = rule.name;
        const newId = generateId(newName);

        const nameConflict = ruleset.rules.find(r =>
          r.id !== rule.id && r.name === newName
        );
        if (nameConflict) {
          console.error('规则名称在该规则集内已存在:', newName);
          return false;
        }

        const existingRule = ruleset.rules[existingIndex];
        const allowedFields = new Set([...COMMON_FIELDS, ...(TYPE_FIELDS[rule.type] || [])]);

        const cleaned = { id: newId };
        for (const key of Object.keys(existingRule)) {
          if (allowedFields.has(key)) {
            cleaned[key] = existingRule[key];
          }
        }
        for (const key of Object.keys(rule)) {
          if (key === 'groupId' || key === 'isGroup') continue;
          if (rule[key] === null) {
            delete cleaned[key];
          } else {
            cleaned[key] = rule[key];
          }
        }
        cleaned.updatedAt = new Date().toISOString();

        ruleset.rules[existingIndex] = cleaned;
      } else {
        const nameConflict = ruleset.rules.find(r => r.name === rule.name);
        if (nameConflict) {
          console.error('规则名称在该规则集内已存在:', rule.name);
          return false;
        }

        const allowedFields = new Set([...COMMON_FIELDS, ...(TYPE_FIELDS[rule.type] || [])]);

        const newRule = { id: generateId(rule.name) };
        for (const key of Object.keys(rule)) {
          if (key === 'groupId' || key === 'isGroup') continue;
          if (rule[key] === null) continue;
          if (allowedFields.has(key)) {
            newRule[key] = rule[key];
          }
        }
        newRule.createdAt = rule.createdAt || new Date().toISOString();
        newRule.updatedAt = new Date().toISOString();

        ruleset.rules.push(newRule);
      }

      ruleset.updatedAt = new Date().toISOString();
      return this.saveRules();
    } catch (error) {
      console.error('保存规则失败:', error);
      return false;
    }
  }

  deleteRule(ruleId, rulesetId = null) {
    try {
      const rulesetIndex = this.rulesets.findIndex(rs => rs.id === ruleId);
      if (rulesetIndex !== -1) {
        this.rulesets.splice(rulesetIndex, 1);
        return this.saveRules();
      }

      if (rulesetId) {
        const ruleset = this.rulesets.find(rs => rs.id === rulesetId);
        if (ruleset) {
          const ruleIndex = ruleset.rules.findIndex(r => r.id === ruleId);
          if (ruleIndex !== -1) {
            ruleset.rules.splice(ruleIndex, 1);
            ruleset.updatedAt = new Date().toISOString();
            return this.saveRules();
          }
        }
        return false;
      }

      for (const ruleset of this.rulesets) {
        const ruleIndex = ruleset.rules.findIndex(r => r.id === ruleId);
        if (ruleIndex !== -1) {
          ruleset.rules.splice(ruleIndex, 1);
          ruleset.updatedAt = new Date().toISOString();
          return this.saveRules();
        }
      }

      return false;
    } catch (error) {
      console.error('删除规则失败:', error);
      return false;
    }
  }

  hasInjectionRules(rulesetId) {
    const ruleset = this.getRulesetById(rulesetId);
    if (!ruleset) return false;
    return ruleset.rules.some(r =>
      r.type === 'zip-implant' || r.type === 'zip-implant-dynamic'
    );
  }

  getEffectiveCompatible(ruleset) {
    if (!ruleset) return true;
    if (ruleset.compatible !== undefined && ruleset.compatible !== null) {
      return ruleset.compatible;
    }
    return !this.hasInjectionRules(ruleset.id);
  }

  toggleRule(ruleId, enabled, compatibilityProtectionEnabled = true, rulesetId = null) {
    try {
      const ruleset = this.getRulesetById(ruleId);
      if (ruleset) {
        ruleset.enabled = enabled;
        ruleset.updatedAt = new Date().toISOString();

        if (enabled) {
          ruleset.rules.forEach(rule => {
            if (rule.maxTriggers !== undefined) {
              rule.currentTriggers = 0;
            }
          });

          const isCurrentCompatible = this.getEffectiveCompatible(ruleset);

          if (compatibilityProtectionEnabled && !isCurrentCompatible) {
            const disabledGroups = [];
            this.rulesets.forEach(rs => {
              if (rs.id !== ruleId && rs.enabled) {
                rs.enabled = false;
                rs.updatedAt = new Date().toISOString();
                disabledGroups.push(rs.name || rs.id);
              }
            });

            if (disabledGroups.length > 0) {
              this.saveRules();
              return { success: true, disabledGroups };
            }
          }
        }

        this.saveRules();
        return { success: true };
      }

      const found = this.findRuleById(ruleId, rulesetId);
      if (found) {
        found.rule.enabled = enabled;
        found.rule.updatedAt = new Date().toISOString();

        if (found.rule.maxTriggers !== undefined) {
          found.rule.currentTriggers = 0;
        }

        found.ruleset.updatedAt = new Date().toISOString();
        this.saveRules();
        return { success: true };
      }

      return false;
    } catch (error) {
      console.error('切换规则状态失败:', error);
      return false;
    }
  }

  resetRuleTriggers(ruleId, rulesetId = null) {
    try {
      const ruleset = this.getRulesetById(ruleId);
      if (ruleset) {
        ruleset.updatedAt = new Date().toISOString();
        ruleset.rules.forEach(rule => {
          if (rule.maxTriggers !== undefined) {
            rule.currentTriggers = 0;
          }
        });
        return this.saveRules();
      }

      const found = this.findRuleById(ruleId, rulesetId);
      if (found) {
        found.rule.updatedAt = new Date().toISOString();
        if (found.rule.maxTriggers !== undefined) {
          found.rule.currentTriggers = 0;
        }
        found.ruleset.updatedAt = new Date().toISOString();
        return this.saveRules();
      }

      return false;
    } catch (error) {
      console.error('重置规则触发次数失败:', error);
      return false;
    }
  }

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
          if (importedData.length > 0 && (importedData[0].isGroup !== undefined || importedData[0].groupId !== undefined)) {
            const migrated = this.migrateFromOldFormat(importedData);
            this.rulesets = [...this.rulesets, ...migrated];
          } else if (importedData.length > 0 && importedData[0].rules !== undefined) {
            this.rulesets = [...this.rulesets, ...importedData];
          } else {
            this.rulesets = [...this.rulesets, ...importedData];
          }
          this.saveRules();
          return { success: true, count: importedData.length };
        }
      }
      return { success: false, error: '未选择文件或文件格式不正确' };
    } catch (error) {
      console.error('导入规则失败:', error);
      return { success: false, error: error.message };
    }
  }

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
      console.error('导出规则失败:', error);
      return { success: false, error: error.message };
    }
  }

  registerIpcHandlers() {
    ipcMain.handle('get-rules', () => {
      return this.getRules();
    });

    ipcMain.handle('get-response-rules', () => {
      return this.getRules();
    });

    ipcMain.handle('save-response-rule', (event, rule) => {
      return { success: this.saveRule(rule) };
    });

    ipcMain.handle('save-rule', (event, rule) => {
      return { success: this.saveRule(rule) };
    });

    ipcMain.handle('save-response-rules', (event, rulesets) => {
      return { success: this.saveRules(rulesets) };
    });

    ipcMain.handle('get-effective-compat', (event, rulesetId) => {
      const ruleset = this.getRulesetById(rulesetId);
      if (!ruleset) return { compatible: true };
      return {
        compatible: this.getEffectiveCompatible(ruleset),
        groupName: ruleset.name
      };
    });

    ipcMain.handle('delete-response-rule', (event, ruleId, rulesetId = null) => {
      return { success: this.deleteRule(ruleId, rulesetId) };
    });

    ipcMain.handle('delete-rule', (event, ruleId, rulesetId = null) => {
      return { success: this.deleteRule(ruleId, rulesetId) };
    });

    ipcMain.handle('toggle-response-rule', (event, ruleId, enabled, compatibilityProtectionEnabled = true, rulesetId = null) => {
      return this.toggleRule(ruleId, enabled, compatibilityProtectionEnabled, rulesetId);
    });

    ipcMain.handle('toggle-rule', (event, { ruleId, enabled, compatibilityProtectionEnabled = true, rulesetId = null }) => {
      return this.toggleRule(ruleId, enabled, compatibilityProtectionEnabled, rulesetId);
    });

    ipcMain.handle('reset-rule-triggers', (event, ruleId, rulesetId = null) => {
      return { success: this.resetRuleTriggers(ruleId, rulesetId) };
    });

    ipcMain.handle('export-response-rules', async () => {
      return await this.exportRules();
    });

    ipcMain.handle('export-rules', async () => {
      return await this.exportRules();
    });

    ipcMain.handle('import-response-rules', async () => {
      return await this.importRules();
    });

    ipcMain.handle('import-rules', async () => {
      return await this.importRules();
    });
  }
}

module.exports = RulesManager;
