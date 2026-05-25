const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { ipcMain, dialog } = require('electron');
const { v4: uuidv4 } = require('uuid');

class RulesManager {
  constructor() {
    this.rulesDir = path.join(os.homedir(), '.Auto366', 'rules');
    this.rulesFile = path.join(this.rulesDir, 'rules.json');
    this.rules = [];
    this.loadRules();
  }

  // 确保规则目录存在
  ensureRulesDirectory() {
    if (!fs.existsSync(this.rulesDir)) {
      fs.mkdirSync(this.rulesDir, { recursive: true });
    }
  }

  // 加载规则
  loadRules() {
    try {
      this.ensureRulesDirectory();

      if (fs.existsSync(this.rulesFile)) {
        const content = fs.readFileSync(this.rulesFile, 'utf-8');
        this.rules = JSON.parse(content);
      } else {
        this.rules = [];
      }
    } catch (error) {
      console.error('加载规则失败:', error);
      this.rules = [];
    }
  }

  // 保存规则
  saveRules(rules = null) {
    try {
      this.ensureRulesDirectory();
      const rulesToSave = rules !== null ? rules : this.rules;
      fs.writeFileSync(this.rulesFile, JSON.stringify(rulesToSave, null, 2), 'utf-8');

      if (rules !== null) {
        this.rules = rules;
      }

      return true;
    } catch (error) {
      console.error('保存规则失败:', error);
      return false;
    }
  }

  // 获取所有规则
  getRules() {
    return this.rules;
  }

  // 添加或更新规则
  saveRule(rule) {
    try {
      if (rule.id) {
        const index = this.rules.findIndex(r => r.id === rule.id);
        if (index !== -1) {
          const updatedRule = {
            ...this.rules[index],
            ...rule,
            updatedAt: new Date().toISOString()
          };
          this.rules[index] = updatedRule;
        }
      } else {
        rule.id = uuidv4();
        rule.createdAt = new Date().toISOString();
        rule.updatedAt = new Date().toISOString();
        this.rules.push(rule);
      }

      return this.saveRules();
    } catch (error) {
      console.error('保存规则失败:', error);
      return false;
    }
  }

  // 删除规则
  deleteRule(ruleId) {
    try {
      const ruleToDelete = this.rules.find(r => r.id === ruleId);

      if (!ruleToDelete) {
        return false;
      }

      if (ruleToDelete.isGroup) {
        this.rules = this.rules.filter(r =>
          r.id !== ruleId && r.groupId !== ruleId
        );
      } else {
        this.rules = this.rules.filter(r => r.id !== ruleId);
      }

      return this.saveRules();
    } catch (error) {
      console.error('删除规则失败:', error);
      return false;
    }
  }

  // 检查规则集是否包含注入规则（自动检测兼容性）
  hasInjectionRules(groupId) {
    return this.rules.some(r =>
      r.groupId === groupId &&
      (r.type === 'zip-implant' || r.type === 'zip-implant-dynamic')
    );
  }

  // 获取规则集的实际兼容性（优先使用手动字段，否则自动检测）
  getEffectiveCompatible(rule) {
    if (!rule || !rule.isGroup) return true;
    if (rule.compatible !== undefined && rule.compatible !== null) {
      return rule.compatible;
    }
    return !this.hasInjectionRules(rule.id);
  }

  // 切换规则启用状态
  toggleRule(ruleId, enabled, compatibilityProtectionEnabled = true) {
    try {
      const rule = this.rules.find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;
        rule.updatedAt = new Date().toISOString();

        if (rule.isGroup && enabled) {
          const childRules = this.rules.filter(r => r.groupId === rule.id);
          childRules.forEach(childRule => {
            if (childRule.maxTriggers !== undefined) {
              childRule.currentTriggers = 0;
            }
          });

          // 获取当前规则集的实际兼容性
          const isCurrentCompatible = this.getEffectiveCompatible(rule);

          // 如果启用了兼容性保护且当前规则集不兼容
          if (compatibilityProtectionEnabled && !isCurrentCompatible) {
            const disabledGroups = [];
            this.rules.forEach(r => {
              if (r.isGroup && r.id !== ruleId && r.enabled) {
                r.enabled = false;
                r.updatedAt = new Date().toISOString();
                disabledGroups.push(r.name || r.id);
              }
            });

            if (disabledGroups.length > 0) {
              this.saveRules();
              return { success: true, disabledGroups };
            }
          }
        }

        if (!rule.isGroup && rule.maxTriggers !== undefined) {
          rule.currentTriggers = 0;
        }

        this.saveRules();
        return { success: true };
      }
      return false;
    } catch (error) {
      console.error('切换规则状态失败:', error);
      return false;
    }
  }

  // 重置规则触发次数
  resetRuleTriggers(ruleId) {
    try {
      const rule = this.rules.find(r => r.id === ruleId);
      if (rule) {
        rule.updatedAt = new Date().toISOString();

        if (rule.isGroup) {
          const childRules = this.rules.filter(r => r.groupId === rule.id);
          childRules.forEach(childRule => {
            if (childRule.maxTriggers !== undefined) {
              childRule.currentTriggers = 0;
            }
          });
        } else if (rule.maxTriggers !== undefined) {
          rule.currentTriggers = 0;
        }

        return this.saveRules();
      }
      return false;
    } catch (error) {
      console.error('重置规则触发次数失败:', error);
      return false;
    }
  }

  // 导入规则
  async importRules() {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const rulesFile = result.filePaths[0];
        const content = fs.readFileSync(rulesFile, 'utf-8');
        const importedRules = JSON.parse(content);

        if (Array.isArray(importedRules)) {
          this.rules = [...this.rules, ...importedRules];
          this.saveRules();
          return { success: true, count: importedRules.length };
        }
      }
      return { success: false, error: '未选择文件或文件格式不正确' };
    } catch (error) {
      console.error('导入规则失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 导出规则
  async exportRules() {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: 'rules.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });

      if (!result.canceled) {
        fs.writeFileSync(result.filePath, JSON.stringify(this.rules, null, 2), 'utf-8');
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

    ipcMain.handle('save-response-rules', (event, rules) => {
      return { success: this.saveRules(rules) };
    });

    ipcMain.handle('get-effective-compat', (event, groupId) => {
      const group = this.rules.find(r => r.id === groupId && r.isGroup);
      if (!group) return { compatible: true };
      return {
        compatible: this.getEffectiveCompatible(group),
        groupName: group.name
      };
    });

    ipcMain.handle('delete-response-rule', (event, ruleId) => {
      return { success: this.deleteRule(ruleId) };
    });

    ipcMain.handle('delete-rule', (event, ruleId) => {
      return { success: this.deleteRule(ruleId) };
    });

    ipcMain.handle('toggle-response-rule', (event, ruleId, enabled, compatibilityProtectionEnabled = true) => {
      return this.toggleRule(ruleId, enabled, compatibilityProtectionEnabled);
    });

    ipcMain.handle('toggle-rule', (event, { ruleId, enabled, compatibilityProtectionEnabled = true }) => {
      return this.toggleRule(ruleId, enabled, compatibilityProtectionEnabled);
    });

    ipcMain.handle('reset-rule-triggers', (event, ruleId) => {
      return { success: this.resetRuleTriggers(ruleId) };
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
