const fs = require('fs');
const path = require('path');
const os = require('os');

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
        const content = fs.readFileSync(this.rulesFile, 'utf8');
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
  saveRules() {
    try {
      this.ensureRulesDirectory();
      fs.writeFileSync(this.rulesFile, JSON.stringify(this.rules, null, 2));
      return { success: true };
    } catch (error) {
      console.error('保存规则失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 获取所有规则
  getRules() {
    return this.rules;
  }

  // 保存规则
  saveRule(rule) {
    try {
      if (rule.id) {
        // 更新现有规则
        const index = this.rules.findIndex(r => r.id === rule.id);
        if (index !== -1) {
          this.rules[index] = rule;
        } else {
          // 规则不存在，添加新规则
          this.rules.push(rule);
        }
      } else {
        // 添加新规则
        rule.id = this.generateId();
        this.rules.push(rule);
      }

      return this.saveRules();
    } catch (error) {
      console.error('保存规则失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 删除规则
  deleteRule(ruleId) {
    try {
      // 检查是否是规则集
      const rule = this.rules.find(r => r.id === ruleId);
      if (rule && rule.isGroup) {
        // 如果是规则集，删除其所有子规则
        this.rules = this.rules.filter(r => r.id !== ruleId && r.groupId !== ruleId);
      } else {
        // 删除单个规则
        this.rules = this.rules.filter(r => r.id !== ruleId);
      }

      return this.saveRules();
    } catch (error) {
      console.error('删除规则失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 切换规则状态
  toggleRule(ruleId, enabled) {
    try {
      const rule = this.rules.find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;

        // 如果是规则集，同步所有子规则的状态
        if (rule.isGroup) {
          this.rules.forEach(r => {
            if (r.groupId === ruleId) {
              r.enabled = enabled;
            }
          });
        }

        return this.saveRules();
      } else {
        return { success: false, error: '规则不存在' };
      }
    } catch (error) {
      console.error('切换规则状态失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 重置规则触发次数
  resetRuleTriggers(ruleId) {
    try {
      // 检查是否是规则集
      const rule = this.rules.find(r => r.id === ruleId);
      if (rule && rule.isGroup) {
        // 如果是规则集，重置所有子规则的触发次数
        this.rules.forEach(r => {
          if (r.groupId === ruleId) {
            r.currentTriggers = 0;
          }
        });
      } else {
        // 重置单个规则的触发次数
        const rule = this.rules.find(r => r.id === ruleId);
        if (rule) {
          rule.currentTriggers = 0;
        }
      }

      return this.saveRules();
    } catch (error) {
      console.error('重置规则触发次数失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 生成规则ID
  generateId() {
    return 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // 匹配规则
  matchRule(url, method, body) {
    const matchingRules = [];

    this.rules.forEach(rule => {
      // 跳过禁用的规则
      if (!rule.enabled) return;

      // 检查触发次数限制
      if (rule.maxTriggers && rule.currentTriggers >= rule.maxTriggers) return;

      // 检查URL匹配
      if (rule.urlPattern) {
        const regex = new RegExp(rule.urlPattern);
        if (!regex.test(url)) return;
      }

      // 检查方法匹配
      if (rule.method && rule.method !== method) return;

      matchingRules.push(rule);
    });

    return matchingRules;
  }

  // 应用规则
  applyRule(rule, data) {
    try {
      // 增加触发次数
      if (rule.maxTriggers) {
        rule.currentTriggers = (rule.currentTriggers || 0) + 1;
        this.saveRules();
      }

      // 根据规则类型应用不同的处理
      switch (rule.type) {
        case 'content-change':
          return this.applyContentChangeRule(rule, data);
        case 'zip-implant':
          return this.applyZipImplantRule(rule, data);
        case 'answer-upload':
          return this.applyAnswerUploadRule(rule, data);
        default:
          return data;
      }
    } catch (error) {
      console.error('应用规则失败:', error);
      return data;
    }
  }

  // 应用内容修改规则
  applyContentChangeRule(rule, data) {
    if (rule.modifyRules && Array.isArray(rule.modifyRules)) {
      rule.modifyRules.forEach(modifyRule => {
        if (modifyRule.find && modifyRule.replace) {
          const regex = new RegExp(modifyRule.find, 'g');
          data = data.replace(regex, modifyRule.replace);
        }
      });
    }
    return data;
  }

  // 应用ZIP注入规则
  applyZipImplantRule(rule, data) {
    // 这里需要根据实际的ZIP注入逻辑实现
    return data;
  }

  // 应用答案上传规则
  applyAnswerUploadRule(rule, data) {
    // 这里需要根据实际的答案上传逻辑实现
    return data;
  }

  // 导入规则
  importRules(rulesData) {
    try {
      if (Array.isArray(rulesData)) {
        rulesData.forEach(rule => {
          if (!rule.id) {
            rule.id = this.generateId();
          }
          this.rules.push(rule);
        });
      } else if (rulesData.rules && Array.isArray(rulesData.rules)) {
        rulesData.rules.forEach(rule => {
          if (!rule.id) {
            rule.id = this.generateId();
          }
          this.rules.push(rule);
        });
      } else if (rulesData.isGroup) {
        if (!rulesData.id) {
          rulesData.id = this.generateId();
        }
        this.rules.push(rulesData);
      }

      return this.saveRules();
    } catch (error) {
      console.error('导入规则失败:', error);
      return { success: false, error: error.message };
    }
  }

  // 导出规则
  exportRules() {
    try {
      return {
        success: true,
        rules: this.rules
      };
    } catch (error) {
      console.error('导出规则失败:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = RulesManager;
