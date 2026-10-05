import { createLogger } from '../../services/logger.js';
const moduleLog = createLogger('规则');
export default {
showRuleGroupModal(ruleGroup = null) {
    const modal = document.getElementById('ruleGroupModal');
    const title = document.getElementById('ruleGroupModalTitle');
    const form = document.getElementById('ruleGroupForm');

    if (ruleGroup) {
      // 编辑模式
      title.textContent = '编辑规则集';
      this.state.currentEditingRuleGroup = ruleGroup;
      this.populateRuleGroupForm(ruleGroup);
    } else {
      // 添加模式
      title.textContent = '添加规则集';
      this.state.currentEditingRuleGroup = null;
      form.reset();
    }

    modal.style.display = 'flex';
  },

hideRuleGroupModal() {
    const modal = document.getElementById('ruleGroupModal');
    modal.style.display = 'none';
    this.state.currentEditingRuleGroup = null;
  },

populateRuleGroupForm(ruleGroup) {
    document.getElementById('ruleGroupName').value = ruleGroup.name || '';
    document.getElementById('ruleGroupDescription').value = ruleGroup.description || '';
    document.getElementById('ruleGroupAuthor').value = ruleGroup.author || '';
    document.getElementById('ruleGroupEnabled').checked = ruleGroup.enabled !== false;
    document.getElementById('ruleGroupCompatible').checked = ruleGroup.compatible !== false;
  },

async saveRuleGroup() {
    const ruleGroup = {
      id: this.state.currentEditingRuleGroup?.id || null,
      name: document.getElementById('ruleGroupName').value.trim(),
      description: document.getElementById('ruleGroupDescription').value.trim(),
      author: document.getElementById('ruleGroupAuthor').value.trim(),
      enabled: document.getElementById('ruleGroupEnabled').checked,
      compatible: document.getElementById('ruleGroupCompatible').checked,
      isGroup: true
    };

    // 验证必填字段
    if (!ruleGroup.name) {
      this.logManager.addErrorLog('请输入规则集名称', "规则");
      return;
    }

    try {
      // 调用后端API保存规则集
      const result = await window.electronAPI.saveRule(ruleGroup);

      if (result && result.success) {
        this.logManager.addSuccessLog(this.state.currentEditingRuleGroup ? '规则集更新成功' : '规则集添加成功', "规则");
        this.hideRuleGroupModal();
        this.loadRules();
        this.renderSimpleHomeRulesets().catch(() => {});
      } else {
        this.logManager.addErrorLog('保存规则集失败: ' + (result ? result.error : '未知错误'), "规则");
      }
    } catch (error) {
      moduleLog.error('保存规则集失败:', error);
      this.logManager.addErrorLog('保存规则集失败: ' + error.message, "规则");
    }
  },

showRuleModal(rule = null, groupId = null) {
    const modal = document.getElementById('ruleModal');
    const title = document.getElementById('ruleModalTitle');
    const form = document.getElementById('ruleForm');

    if (rule) {
      title.textContent = '编辑规则';
      this.state.currentEditingRule = rule;
      this.state.currentRuleGroupId = groupId;
      this.populateRuleForm(rule);
    } else {
      title.textContent = '添加规则';
      this.state.currentEditingRule = null;
      this.state.currentRuleGroupId = groupId;
      form.reset();
      this.showRuleFields('');
    }

    modal.style.display = 'flex';
  },

hideRuleModal() {
    const modal = document.getElementById('ruleModal');
    modal.style.display = 'none';
    this.state.currentEditingRule = null;
  },

showRuleFields(ruleType) {
    // 规则类型到字段容器ID的映射表
    const FIELD_ID_MAP = {
      'content-change': 'contentchangeFields',
      'zip-implant': 'zipimplantFields',
      'zip-implant-dynamic': 'zipimplantdynamicFields',
      'answer-upload': 'answeruploadFields',
      'post-change-time': 'postchangetimeFields',
      'tts-generate': 'ttsgenerateFields'
    };

    // 隐藏所有规则字段
    const allFields = document.querySelectorAll('.rule-form__fields');
    allFields.forEach(field => {
      field.style.display = 'none';
    });

    // 显示对应的字段
    if (ruleType) {
      const targetFields = document.getElementById(FIELD_ID_MAP[ruleType]);
      if (targetFields) {
        targetFields.style.display = 'block';
      }
    }
  },

populateRuleForm(rule) {
    document.getElementById('ruleName').value = rule.name || '';
    document.getElementById('ruleType').value = rule.type || '';
    document.getElementById('ruleDescription').value = rule.description || '';
    document.getElementById('ruleEnabled').checked = rule.enabled !== false;

    // 显示对应的字段
    this.showRuleFields(rule.type);

    // 根据规则类型填充特定字段
    if (rule.type === 'content-change') {
      document.getElementById('urlPattern').value = rule.urlPattern || '';
      document.getElementById('changeType').value = rule.changeType || 'request-body';
      document.getElementById('originalContent').value = rule.originalContent || '';
      document.getElementById('newContent').value = rule.newContent || '';
    } else if (rule.type === 'zip-implant') {
      document.getElementById('urlFileinfo').value = rule.urlFileinfo || '';
      document.getElementById('urlZip').value = rule.urlZip || '';
      document.getElementById('targetFileName').value = rule.targetFileName || '';
      document.getElementById('zipImplant').value = rule.zipImplant || '';
    } else if (rule.type === 'zip-implant-dynamic') {
      document.getElementById('dynUrlFileinfo').value = rule.urlFileinfo || '';
      document.getElementById('dynUrlZip').value = rule.urlZip || '';
      document.getElementById('dynTargetFileName').value = rule.targetFileName || '';
      document.getElementById('dynInjectScript').value = rule.injectScript || '';
      document.getElementById('dynInjectScripts').value = Array.isArray(rule.injectScripts) ? rule.injectScripts.join('\n') : '';
      document.getElementById('dynDownloadTimeout').value = rule.downloadTimeout || '';
    } else if (rule.type === 'answer-upload') {
      document.getElementById('urlUpload').value = rule.urlUpload || '';
      document.getElementById('uploadType').value = rule.uploadType || 'original';
      document.getElementById('serverLocate').value = rule.serverLocate || '';
    } else if (rule.type === 'post-change-time') {
      document.getElementById('pctUrlRequest').value = rule.urlRequest || '';
      document.getElementById('pctSalt').value = rule.salt || '';
      document.getElementById('pctTargetSeconds').value = rule.targetSeconds || 1212;
    } else if (rule.type === 'tts-generate') {
      document.getElementById('ttsBasePath').value = rule.ttsBasePath || '/tts';
    }

    let maxTriggersInput;
    if (rule.type === 'content-change') {
      maxTriggersInput = document.querySelector('#contentChangeMaxTriggers');
    } else if (rule.type === 'zip-implant') {
      maxTriggersInput = document.querySelector('#zipImplantMaxTriggers');
    } else if (rule.type === 'zip-implant-dynamic') {
      maxTriggersInput = document.querySelector('#dynMaxTriggers');
    } else if (rule.type === 'answer-upload') {
      maxTriggersInput = document.querySelector('#answerUploadMaxTriggers');
    }

    if (maxTriggersInput) {
      maxTriggersInput.value = rule.maxTriggers || '';
    }
  },

async saveRule() {
    // 基本信息
    const rule = {
      id: this.state.currentEditingRule?.id || null,
      name: document.getElementById('ruleName').value.trim(),
      type: document.getElementById('ruleType').value,
      description: document.getElementById('ruleDescription').value.trim(),
      enabled: document.getElementById('ruleEnabled').checked,
      groupId: this.state.currentRuleGroupId || null
    };

    // 验证基本字段
    if (!rule.name) {
      this.logManager.addErrorLog('请输入规则名称', "规则");
      return;
    }

    if (!rule.type) {
      this.logManager.addErrorLog('请选择规则类型', "规则");
      return;
    }

    // 根据规则类型添加特定字段
    if (rule.type === 'content-change') {
      rule.urlPattern = document.getElementById('urlPattern').value.trim();
      rule.changeType = document.getElementById('changeType').value;
      rule.originalContent = document.getElementById('originalContent').value.trim();
      rule.newContent = document.getElementById('newContent').value.trim();
      rule.action = 'modify';
      rule.modifyRules = [
        {
          find: rule.originalContent,
          replace: rule.newContent
        }
      ];

      if (!rule.urlPattern) {
        this.logManager.addErrorLog('请输入URL匹配模式', "规则");
        return;
      }
    } else if (rule.type === 'zip-implant') {
      rule.urlFileinfo = document.getElementById('urlFileinfo').value.trim();
      rule.urlZip = document.getElementById('urlZip').value.trim();
      rule.targetFileName = document.getElementById('targetFileName').value.trim();
      rule.zipImplant = document.getElementById('zipImplant').value.trim();

      if (!rule.urlZip) {
        this.logManager.addErrorLog('请输入ZIP文件URL匹配', "规则");
        return;
      }

      if (!rule.zipImplant) {
        this.logManager.addErrorLog('请选择注入ZIP文件', "规则");
        return;
      }
    } else if (rule.type === 'zip-implant-dynamic') {
      rule.urlFileinfo = document.getElementById('dynUrlFileinfo').value.trim();
      rule.urlZip = document.getElementById('dynUrlZip').value.trim();
      rule.targetFileName = document.getElementById('dynTargetFileName').value.trim();
      rule.injectScript = document.getElementById('dynInjectScript').value.trim();
      const scriptsText = document.getElementById('dynInjectScripts').value.trim();
      rule.injectScripts = scriptsText ? scriptsText.split('\n').map(s => s.trim()).filter(Boolean) : null;
      rule.downloadTimeout = parseInt(document.getElementById('dynDownloadTimeout').value) || 30000;

      if (!rule.urlFileinfo) {
        this.logManager.addErrorLog('请输入文件信息URL匹配', "规则");
        return;
      }

      if (!rule.urlZip) {
        this.logManager.addErrorLog('请输入ZIP文件URL匹配', "规则");
        return;
      }

      if (!rule.targetFileName) {
        this.logManager.addErrorLog('请输入目标注入文件名', "规则");
        return;
      }
    } else if (rule.type === 'answer-upload') {
      rule.urlUpload = document.getElementById('urlUpload').value.trim();
      rule.uploadType = document.getElementById('uploadType').value;
      rule.serverLocate = document.getElementById('serverLocate').value.trim();

      if (!rule.urlUpload) {
        this.logManager.addErrorLog('请输入上传URL匹配', "规则");
        return;
      }
    } else if (rule.type === 'post-change-time') {
      rule.urlRequest = document.getElementById('pctUrlRequest').value.trim();
      rule.salt = document.getElementById('pctSalt').value.trim();
      rule.targetSeconds = parseInt(document.getElementById('pctTargetSeconds').value) || 1212;
      rule.method = 'POST';

      if (!rule.urlRequest) {
        this.logManager.addErrorLog('请输入URL匹配模式', "规则");
        return;
      }
    } else if (rule.type === 'tts-generate') {
      rule.ttsBasePath = document.getElementById('ttsBasePath').value.trim() || '/tts';
    }

    let maxTriggersInput;
    const ruleType = document.getElementById('ruleType').value;

    if (ruleType === 'content-change') {
      maxTriggersInput = document.querySelector('#contentChangeMaxTriggers');
    } else if (ruleType === 'zip-implant') {
      maxTriggersInput = document.querySelector('#zipImplantMaxTriggers');
    } else if (ruleType === 'zip-implant-dynamic') {
      maxTriggersInput = document.querySelector('#dynMaxTriggers');
    } else if (ruleType === 'answer-upload') {
      maxTriggersInput = document.querySelector('#answerUploadMaxTriggers');
    }

    const maxTriggersValue = maxTriggersInput ? maxTriggersInput.value.trim() : '';

    if (maxTriggersValue && parseInt(maxTriggersValue) > 0) {
      rule.maxTriggers = parseInt(maxTriggersValue);
      rule.currentTriggers = 0;
    } else {
      rule.maxTriggers = null;
      rule.currentTriggers = null;
    }

    try {
      const result = await window.electronAPI.saveRule(rule);

      if (result && result.success) {
        this.logManager.addSuccessLog(this.state.currentEditingRule ? '规则更新成功' : '规则添加成功', "规则");
        this.hideRuleModal();
        this.loadRules();
        this.renderSimpleHomeRulesets().catch(() => {});
      } else {
        this.logManager.addErrorLog('保存规则失败: ' + (result ? result.error : '未知错误'), "规则");
      }
    } catch (error) {
      moduleLog.error('保存规则失败:', error);
      this.logManager.addErrorLog('保存规则失败: ' + error.message, "规则");
    }
  }
};
