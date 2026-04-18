const fs = require('fs');
const path = require('path');

class RulesLoader {
  constructor() {
    this.rulesetsDir = path.join(__dirname, '../rulesets');
  }

  // 加载内置规则集
  loadBuiltInRulesets() {
    try {
      const rulesets = [];

      // 扫描规则集目录
      if (fs.existsSync(this.rulesetsDir)) {
        const dirs = fs.readdirSync(this.rulesetsDir);

        dirs.forEach(dir => {
          const rulesetDir = path.join(this.rulesetsDir, dir);
          if (fs.statSync(rulesetDir).isDirectory()) {
            const ruleset = this.loadRuleset(rulesetDir);
            if (ruleset) {
              rulesets.push(ruleset);
            }
          }
        });
      }

      return rulesets;
    } catch (error) {
      console.error('加载内置规则集失败:', error);
      return [];
    }
  }

  // 加载单个规则集
  loadRuleset(rulesetDir) {
    try {
      // 读取规则集配置文件
      const configFile = path.join(rulesetDir, 'ruleset.json');
      if (!fs.existsSync(configFile)) {
        return null;
      }

      const configContent = fs.readFileSync(configFile, 'utf8');
      const config = JSON.parse(configContent);

      // 读取规则文件
      const ruleFiles = fs.readdirSync(rulesetDir).filter(file => file.endsWith('.json') && file !== 'ruleset.json');
      const rules = [];

      ruleFiles.forEach(file => {
        const ruleFile = path.join(rulesetDir, file);
        const ruleContent = fs.readFileSync(ruleFile, 'utf8');
        const ruleData = JSON.parse(ruleContent);

        if (Array.isArray(ruleData)) {
          rules.push(...ruleData);
        } else if (ruleData.rules) {
          rules.push(...ruleData.rules);
        } else if (ruleData.isGroup) {
          rules.push(ruleData);
        }
      });

      return {
        name: config.name || path.basename(rulesetDir),
        description: config.description || '',
        author: config.author || '',
        version: config.version || '1.0.0',
        rules: rules
      };

    } catch (error) {
      console.error(`加载规则集 ${path.basename(rulesetDir)} 失败:`, error);
      return null;
    }
  }

  // 获取规则集信息
  getRulesetInfo(rulesetName) {
    try {
      const rulesetDir = path.join(this.rulesetsDir, rulesetName);
      if (!fs.existsSync(rulesetDir)) {
        return null;
      }

      const configFile = path.join(rulesetDir, 'ruleset.json');
      if (!fs.existsSync(configFile)) {
        return null;
      }

      const configContent = fs.readFileSync(configFile, 'utf8');
      return JSON.parse(configContent);

    } catch (error) {
      console.error(`获取规则集信息失败:`, error);
      return null;
    }
  }

  // 列出所有规则集
  listRulesets() {
    try {
      const rulesets = [];

      if (fs.existsSync(this.rulesetsDir)) {
        const dirs = fs.readdirSync(this.rulesetsDir);

        dirs.forEach(dir => {
          const rulesetDir = path.join(this.rulesetsDir, dir);
          if (fs.statSync(rulesetDir).isDirectory()) {
            const info = this.getRulesetInfo(dir);
            if (info) {
              rulesets.push({
                name: info.name || dir,
                description: info.description || '',
                author: info.author || '',
                version: info.version || '1.0.0',
                directory: dir
              });
            }
          }
        });
      }

      return rulesets;

    } catch (error) {
      console.error('列出规则集失败:', error);
      return [];
    }
  }
}

module.exports = RulesLoader;
