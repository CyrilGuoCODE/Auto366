const moduleLog = require('../logging').create('规则');
const storageMethods = require('./storage');

const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ipcMain = require('../register').forModule('rules');

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
      moduleLog.error('保存规则失败:', error);
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
          moduleLog.error('规则集名称已存在:', newName);
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
          moduleLog.error('规则集名称已存在:', ruleset.name);
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
      moduleLog.error('保存规则集失败:', error);
      return false;
    }
  }

  _saveRuleItem(rule) {
    try {
      const rulesetId = rule.groupId;
      if (!rulesetId) {
        moduleLog.error('规则缺少所属规则集ID');
        return false;
      }

      const ruleset = this.getRulesetById(rulesetId);
      if (!ruleset) {
        moduleLog.error('未找到所属规则集:', rulesetId);
        return false;
      }

      if (!rule.name) return false;

      const existingIndex = ruleset.rules.findIndex(r => r.id === rule.id);

      const COMMON_FIELDS = new Set(['id', 'name', 'type', 'description', 'enabled', 'isBuiltin', 'createdAt', 'updatedAt', 'maxTriggers', 'currentTriggers']);
      const TYPE_FIELDS = {
        'content-change': ['urlPattern', 'changeType', 'originalContent', 'newContent', 'newContentFile', 'action', 'modifyRules'],
        'zip-implant': ['urlFileinfo', 'urlZip', 'targetFileName', 'zipImplant'],
        'zip-implant-dynamic': ['urlFileinfo', 'urlZip', 'targetFileName', 'injectScript', 'injectScripts', 'downloadTimeout'],
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
          moduleLog.error('规则名称在该规则集内已存在:', newName);
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
          moduleLog.error('规则名称在该规则集内已存在:', rule.name);
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
      moduleLog.error('保存规则失败:', error);
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
      moduleLog.error('删除规则失败:', error);
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
              return { success: this.saveRules(), disabledGroups };
            }
          }
        }

        return { success: this.saveRules() };
      }

      const found = this.findRuleById(ruleId, rulesetId);
      if (found) {
        found.rule.enabled = enabled;
        found.rule.updatedAt = new Date().toISOString();

        if (found.rule.maxTriggers !== undefined) {
          found.rule.currentTriggers = 0;
        }

        found.ruleset.updatedAt = new Date().toISOString();
        return { success: this.saveRules() };
      }

      return false;
    } catch (error) {
      moduleLog.error('切换规则状态失败:', error);
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
      moduleLog.error('重置规则触发次数失败:', error);
      return false;
    }
  }

  registerIpcHandlers() {
    require('./ipc')(this);
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

// Submodules share this feature's instance; existing method contracts stay unchanged.
Object.assign(RulesManager.prototype, storageMethods);
module.exports = RulesManager;
