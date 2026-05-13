const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class RulesLoader {
  constructor(appPath) {
    this.appPath = appPath || process.cwd();
    this.rulesetsDir = path.join(this.appPath, 'rulesets');
  }

  async loadBuiltinRulesets(rulesManager) {
    try {
      const existingRules = rulesManager.getRules();
      const existingBuiltinGroup = existingRules.find(rule =>
        rule.isGroup && rule.isBuiltin && rule.name === '内置-答案获取'
      );

      if (!existingBuiltinGroup) {
        const answerGroupId = uuidv4();
        const answerGroup = {
          id: answerGroupId,
          name: '内置-答案获取',
          description: '程序内置的空规则集，仅用于答案获取功能',
          isGroup: true,
          isBuiltin: true,
          enabled: true,
          compatible: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        rulesManager.saveRules([...existingRules, answerGroup]);
        console.log('成功导入内置规则集: 内置-答案获取 (0 个规则)');
      }

      if (!fs.existsSync(this.rulesetsDir)) {
        console.log('内置规则集目录不存在:', this.rulesetsDir);
        return;
      }

      const folders = fs.readdirSync(this.rulesetsDir).filter(item => {
        const itemPath = path.join(this.rulesetsDir, item);
        return fs.statSync(itemPath).isDirectory();
      });

      for (const folderName of folders) {
        const folderPath = path.join(this.rulesetsDir, folderName);
        const rulesetJsonPath = path.join(folderPath, 'ruleset.json');
        const rulesJsonPath = path.join(folderPath, `${folderName}.json`);

        if (!fs.existsSync(rulesetJsonPath) || !fs.existsSync(rulesJsonPath)) {
          console.log(`跳过不完整的规则集: ${folderName}`);
          continue;
        }

        try {
          const rulesetInfo = JSON.parse(fs.readFileSync(rulesetJsonPath, 'utf-8'));
          let rulesData = JSON.parse(fs.readFileSync(rulesJsonPath, 'utf-8'));

          rulesData = rulesData.map(rule => {
            if (rule.type === 'zip-implant' && rule.zipImplant && !rule.zipImplant.startsWith('http')) {
              const zipPath = path.join(folderPath, rule.zipImplant);
              if (fs.existsSync(zipPath)) {
                rule.zipImplant = zipPath;
              }
            }
            if (rule.type === 'zip-implant-dynamic' && rule.injectScript && !rule.injectScript.startsWith('http') && !path.isAbsolute(rule.injectScript)) {
              const scriptPath = path.join(folderPath, rule.injectScript);
              if (fs.existsSync(scriptPath)) {
                rule.injectScript = scriptPath;
              }
            }
            return rule;
          });

          const groupId = uuidv4();
          const rulesetGroup = {
            id: groupId,
            name: rulesetInfo.name,
            description: rulesetInfo.description,
            isGroup: true,
            isBuiltin: true,
            enabled: false,
            compatible: rulesetInfo.compatible !== undefined ? rulesetInfo.compatible : false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          const rules = rulesData.map(rule => ({
            ...rule,
            groupId: groupId,
            isBuiltin: true,
            enabled: false,
            createdAt: rule.createdAt || new Date().toISOString(),
            updatedAt: rule.updatedAt || new Date().toISOString()
          }));

          const currentRules = rulesManager.getRules();
          const existingRulesetGroup = currentRules.find(rule =>
            rule.isGroup && rule.isBuiltin && rule.name === rulesetInfo.name
          );

          if (existingRulesetGroup) {
            console.log(`内置规则集已存在，跳过: ${rulesetInfo.name}`);
            continue;
          }

          rulesManager.saveRules([...currentRules, rulesetGroup, ...rules]);

          console.log(`成功导入内置规则集: ${rulesetInfo.name} (${rules.length} 个规则)`);
        } catch (error) {
          console.error(`导入规则集 ${folderName} 失败:`, error);
        }
      }

      console.log('内置规则集导入完成');
    } catch (error) {
      console.error('导入内置规则集失败:', error);
    }
  }
}

module.exports = RulesLoader;
