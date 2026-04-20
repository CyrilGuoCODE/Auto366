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
            return rule;
          });

          const groupId = uuidv4();
          const rulesetGroup = {
            id: groupId,
            name: rulesetInfo.name,
            description: rulesetInfo.description,
            isGroup: true,
            isBuiltin: true,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          const rules = rulesData.map(rule => ({
            ...rule,
            groupId: groupId,
            isBuiltin: true,
            createdAt: rule.createdAt || new Date().toISOString(),
            updatedAt: rule.updatedAt || new Date().toISOString()
          }));

          const existingRules = rulesManager.getRules();
          const existingBuiltinGroup = existingRules.find(rule =>
            rule.isGroup && rule.isBuiltin && rule.name === rulesetInfo.name
          );

          if (existingBuiltinGroup) {
            console.log(`内置规则集已存在，跳过: ${rulesetInfo.name}`);
            continue;
          }

          rulesManager.saveRules([...existingRules, rulesetGroup, ...rules]);

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
