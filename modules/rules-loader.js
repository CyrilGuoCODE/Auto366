const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

function generateId(name) {
  return crypto.createHash('md5').update(name).digest('hex');
}

class RulesLoader {
  constructor(appPath) {
    this.appPath = appPath || process.cwd();
    this.rulesetsDir = path.join(this.appPath, 'rulesets');
  }

  async loadBuiltinRulesets(rulesManager) {
    try {
      await this._ensureAnswerRuleset(rulesManager);

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
          const builtinVersion = rulesetInfo.version || 0;

          const currentRulesets = rulesManager.getRules();
          const existingRuleset = currentRulesets.find(rs =>
            rs.isBuiltin && rs.name === rulesetInfo.name
          );

          const localVersion = existingRuleset ? (existingRuleset.version || 0) : -1;

          if (existingRuleset && localVersion >= builtinVersion) {
            console.log(`内置规则集版本一致，跳过: ${rulesetInfo.name} (v${localVersion})`);
            continue;
          }

          const needUpdate = existingRuleset && localVersion < builtinVersion;
          if (needUpdate) {
            console.log(`内置规则集版本更新: ${rulesetInfo.name} v${localVersion} -> v${builtinVersion}`);
          }

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

          const hasInjectionRules = rulesData.some(rule =>
            rule.type === 'zip-implant' || rule.type === 'zip-implant-dynamic'
          );
          const autoCompatible = !hasInjectionRules;
          const finalCompatible = rulesetInfo.compatible !== undefined
            ? rulesetInfo.compatible
            : autoCompatible;

          const rulesetId = existingRuleset ? existingRuleset.id : generateId(rulesetInfo.name);

          const rules = rulesData.map(rule => {
            const { groupId, isGroup, ...ruleData } = rule;
            return {
              ...ruleData,
              id: generateId(rule.name),
              isBuiltin: true,
              enabled: true,
              createdAt: rule.createdAt || new Date().toISOString(),
              updatedAt: rule.updatedAt || new Date().toISOString()
            };
          });

          const preservedEnabled = existingRuleset ? existingRuleset.enabled : false;

          const newRuleset = {
            id: rulesetId,
            name: rulesetInfo.name,
            description: rulesetInfo.description,
            isBuiltin: true,
            enabled: preservedEnabled,
            compatible: finalCompatible,
            version: builtinVersion,
            createdAt: existingRuleset ? existingRuleset.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rules: rules
          };

          let updatedRulesets;
          if (existingRuleset) {
            updatedRulesets = rulesManager.getRules().map(rs =>
              rs.id === existingRuleset.id ? newRuleset : rs
            );
          } else {
            updatedRulesets = rulesManager.getRules();
            const isNewRulesetCompatible = rulesetInfo.compatible !== undefined ? rulesetInfo.compatible : false;
            if (!isNewRulesetCompatible) {
              updatedRulesets = updatedRulesets.map(rs => {
                if (rs.compatible === false && rs.enabled) {
                  console.log(`关闭不兼容规则集: ${rs.name}`);
                  return { ...rs, enabled: false };
                }
                return rs;
              });
            }
            updatedRulesets = [...updatedRulesets, newRuleset];
          }

          rulesManager.saveRules(updatedRulesets);

          const action = needUpdate ? '更新' : '导入';
          console.log(`成功${action}内置规则集: ${rulesetInfo.name} v${builtinVersion} (${rules.length} 个规则)`);
        } catch (error) {
          console.error(`导入规则集 ${folderName} 失败:`, error);
        }
      }

      console.log('内置规则集导入完成');
    } catch (error) {
      console.error('导入内置规则集失败:', error);
    }
  }

  async _ensureAnswerRuleset(rulesManager) {
    const currentRulesets = rulesManager.getRules();
    const existing = currentRulesets.find(rs =>
      rs.isBuiltin && rs.name === '内置-答案获取'
    );

    if (!existing) {
      const answerRuleset = {
        id: generateId('内置-答案获取'),
        name: '内置-答案获取',
        description: '程序内置的空规则集，仅用于答案获取功能',
        isBuiltin: true,
        enabled: true,
        compatible: false,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rules: []
      };

      rulesManager.saveRules([...currentRulesets, answerRuleset]);
      console.log('成功导入内置规则集: 内置-答案获取 (0 个规则)');
    }
  }
}

module.exports = RulesLoader;
