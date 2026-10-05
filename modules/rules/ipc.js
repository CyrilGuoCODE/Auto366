
const ipcMain = require('../register').forModule('rules');

module.exports = function register(rulesManager) {
    const actionTypes = (e, ruleType) => {
      if (ruleType === 'request') {
        return [
          { value: 'replace', label: '替换请求体', description: '' },
          { value: 'modify', label: '修改请求体', description: '' },
          { value: 'redirect', label: '重定向URL', description: '' }
        ];
      }
      if (ruleType === 'response-headers') {
        return [
          { value: 'modify', label: '修改响应头', description: '' },
          { value: 'remove', label: '删除响应头', description: '' }
        ];
      }
      return [
        { value: 'replace', label: '替换响应体', description: '' },
        { value: 'modify', label: '修改响应体', description: '' },
        { value: 'inject', label: '注入内容', description: '' }
      ];
    };
  ipcMain.handle('get-action-types', actionTypes);
  require('../register').forModule('window', { legacy: false }).handle('get-action-types', actionTypes);

ipcMain.handle('import-response-rules-from-data', async (event, rulesData) => {
      try {
        let rules;
        if (typeof rulesData === 'string') {
          rules = JSON.parse(rulesData);
        } else {
          rules = rulesData;
        }

        let groupToImport = null;
        let rulesToImport = [];

        if (Array.isArray(rules)) {
          const hasOldFormat = rules.some(item => item.isGroup !== undefined || item.groupId !== undefined);
          if (hasOldFormat) {
            const groups = rules.filter(r => r.isGroup);
            const childRules = rules.filter(r => !r.isGroup);
            if (groups.length > 0) {
              groupToImport = groups[0];
              rulesToImport = childRules.filter(r => r.groupId === groupToImport.id);
            } else {
              rulesToImport = childRules;
            }
          } else if (rules.length > 0 && rules[0].rules !== undefined) {
            const importedRuleset = rules[0];
            groupToImport = { ...importedRuleset };
            rulesToImport = importedRuleset.rules || [];
            delete groupToImport.rules;
          } else {
            rulesToImport = rules;
          }
        } else if (rules.group && rules.rules) {
          groupToImport = rules.group;
          rulesToImport = rules.rules;
        } else if (rules.rules && Array.isArray(rules.rules)) {
          rulesToImport = rules.rules;
        } else if (rules.isGroup) {
          groupToImport = rules;
        } else {
          return { success: false, error: '无效的规则数据格式' };
        }

        const currentRulesets = rulesManager.getRules();

        if (groupToImport) {
          const crypto = require('crypto');
          const generateId = (name) => crypto.createHash('md5').update(name).digest('hex');

          // The legacy persisted field stays readable across application upgrades.
          const extensionId = groupToImport.extensionRulesetId || groupToImport.communityRulesetId;
          const existingRulesetIndex = currentRulesets.findIndex(rs =>
            (extensionId && (rs.extensionRulesetId || rs.communityRulesetId) === extensionId) ||
            (rs.name === groupToImport.name && rs.author === groupToImport.author)
          );

          const rulesetId = existingRulesetIndex !== -1
            ? currentRulesets[existingRulesetIndex].id
            : generateId(groupToImport.name);

          const newRules = rulesToImport.map(rule => {
            const { groupId, isGroup, ...ruleData } = rule;
            return {
              ...ruleData,
              id: generateId(rule.name),
            };
          });

          const newRuleset = {
            id: rulesetId,
            name: groupToImport.name,
            description: groupToImport.description || '',
            author: groupToImport.author || '',
            isBuiltin: groupToImport.isBuiltin || false,
            enabled: groupToImport.enabled !== undefined ? groupToImport.enabled : true,
            compatible: groupToImport.compatible,
            communityRulesetId: extensionId,
            createdAt: groupToImport.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rules: newRules
          };

          if (existingRulesetIndex !== -1) {
            const updatedRulesets = [...currentRulesets];
            updatedRulesets[existingRulesetIndex] = newRuleset;
            if (!rulesManager.saveRules(updatedRulesets)) throw new Error('保存规则失败');
          } else {
            if (!rulesManager.saveRules([...currentRulesets, newRuleset])) throw new Error('保存规则失败');
          }
        } else {
          const crypto = require('crypto');
          const generateId = (name) => crypto.createHash('md5').update(name).digest('hex');

          const existingRuleNames = [];
          for (const rs of currentRulesets) {
            for (const r of rs.rules) {
              if (r.name) existingRuleNames.push(r.name);
            }
          }

          rulesToImport = rulesToImport.filter(rule => {
            if (rule.name && existingRuleNames.includes(rule.name)) {
              return false;
            }
            return true;
          });

          if (rulesToImport.length > 0) {
            const defaultRuleset = {
              id: generateId('导入的规则'),
              name: '导入的规则',
              description: '从外部导入的规则',
              enabled: true,
              compatible: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              rules: rulesToImport.map(rule => {
                const { groupId, isGroup, ...ruleData } = rule;
                return {
                  ...ruleData,
                  id: generateId(rule.name),
                };
              })
            };
            if (!rulesManager.saveRules([...currentRulesets, defaultRuleset])) throw new Error('保存规则失败');
          }
        }
        return { success: true, count: rulesToImport.length };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
};
