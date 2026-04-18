import Utils from './utils.js';

class RulesUI {
  constructor(state, logManager) {
    this.state = state;
    this.logManager = logManager;
  }

  // 初始化规则事件监听器
  initRuleEventListeners() {
    // 添加规则集按钮
    const addRuleGroupBtn = document.getElementById('addRuleGroupBtn');
    if (addRuleGroupBtn) {
      addRuleGroupBtn.addEventListener('click', () => {
        this.showRuleGroupModal();
      });
    }

    // 规则集模态框事件
    const closeRuleGroupModal = document.getElementById('closeRuleGroupModal');
    if (closeRuleGroupModal) {
      closeRuleGroupModal.addEventListener('click', () => {
        this.hideRuleGroupModal();
      });
    }

    const cancelRuleGroupBtn = document.getElementById('cancelRuleGroupBtn');
    if (cancelRuleGroupBtn) {
      cancelRuleGroupBtn.addEventListener('click', () => {
        this.hideRuleGroupModal();
      });
    }

    const ruleGroupForm = document.getElementById('ruleGroupForm');
    if (ruleGroupForm) {
      ruleGroupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveRuleGroup();
      });
    }

    const ruleGroupModal = document.getElementById('ruleGroupModal');
    if (ruleGroupModal) {
      ruleGroupModal.addEventListener('click', (e) => {
        if (e.target === ruleGroupModal) {
          this.hideRuleGroupModal();
        }
      });
    }

    // 关闭规则模态框按钮
    const closeRuleModal = document.getElementById('closeRuleModal');
    if (closeRuleModal) {
      closeRuleModal.addEventListener('click', () => {
        this.hideRuleModal();
      });
    }

    // 取消按钮
    const cancelRuleBtn = document.getElementById('cancelRuleBtn');
    if (cancelRuleBtn) {
      cancelRuleBtn.addEventListener('click', () => {
        this.hideRuleModal();
      });
    }

    // 规则类型选择
    const ruleType = document.getElementById('ruleType');
    if (ruleType) {
      ruleType.addEventListener('change', (e) => {
        this.showRuleFields(e.target.value);
      });
    }

    // 浏览ZIP文件按钮
    const browseZipBtn = document.getElementById('browseZipBtn');
    if (browseZipBtn) {
      browseZipBtn.addEventListener('click', () => {
        this.browseZipFile();
      });
    }

    // 规则表单提交
    const ruleForm = document.getElementById('ruleForm');
    if (ruleForm) {
      ruleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveRule();
      });
    }

    // 模态框背景点击关闭
    const ruleModal = document.getElementById('ruleModal');
    if (ruleModal) {
      ruleModal.addEventListener('click', (e) => {
        if (e.target === ruleModal) {
          this.hideRuleModal();
        }
      });
    }
  }

  // 显示规则集模态框
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
  }

  // 隐藏规则集模态框
  hideRuleGroupModal() {
    const modal = document.getElementById('ruleGroupModal');
    modal.style.display = 'none';
    this.state.currentEditingRuleGroup = null;
  }

  // 填充规则集表单
  populateRuleGroupForm(ruleGroup) {
    document.getElementById('ruleGroupName').value = ruleGroup.name || '';
    document.getElementById('ruleGroupDescription').value = ruleGroup.description || '';
    document.getElementById('ruleGroupAuthor').value = ruleGroup.author || '';
    document.getElementById('ruleGroupEnabled').checked = ruleGroup.enabled !== false;
  }

  // 保存规则集
  async saveRuleGroup() {
    const ruleGroup = {
      id: this.state.currentEditingRuleGroup?.id || null,
      name: document.getElementById('ruleGroupName').value.trim(),
      description: document.getElementById('ruleGroupDescription').value.trim(),
      author: document.getElementById('ruleGroupAuthor').value.trim(),
      enabled: document.getElementById('ruleGroupEnabled').checked,
      isGroup: true,
      rules: this.state.currentEditingRuleGroup?.rules || []
    };

    // 验证必填字段
    if (!ruleGroup.name) {
      this.logManager.addErrorLog('请输入规则集名称');
      return;
    }

    try {
      // 调用后端API保存规则集
      const result = await window.electronAPI.saveRule(ruleGroup);

      if (result && result.success) {
        this.logManager.addSuccessLog(this.state.currentEditingRuleGroup ? '规则集更新成功' : '规则集添加成功');
        this.hideRuleGroupModal();
        this.loadRules();
      } else {
        this.logManager.addErrorLog('保存规则集失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (error) {
      console.error('保存规则集失败:', error);
      this.logManager.addErrorLog('保存规则集失败: ' + error.message);
    }
  }

  // 显示规则模态框
  showRuleModal(rule = null, groupId = null) {
    const modal = document.getElementById('ruleModal');
    const title = document.getElementById('ruleModalTitle');
    const form = document.getElementById('ruleForm');

    if (rule) {
      // 编辑模式
      title.textContent = '编辑规则';
      this.state.currentEditingRule = rule;
      this.state.currentRuleGroupId = rule.groupId || groupId;
      this.populateRuleForm(rule);
    } else {
      // 添加模式
      title.textContent = '添加规则';
      this.state.currentEditingRule = null;
      this.state.currentRuleGroupId = groupId;
      form.reset();
      this.showRuleFields('');
    }

    modal.style.display = 'flex';
  }

  // 隐藏规则模态框
  hideRuleModal() {
    const modal = document.getElementById('ruleModal');
    modal.style.display = 'none';
    this.state.currentEditingRule = null;
  }

  // 显示规则字段
  showRuleFields(ruleType) {
    // 隐藏所有规则字段
    const allFields = document.querySelectorAll('.rule-fields');
    allFields.forEach(field => {
      field.style.display = 'none';
    });

    // 显示对应的字段
    if (ruleType) {
      const targetFields = document.getElementById(`${ruleType.replace('-', '')}Fields`);
      if (targetFields) {
        targetFields.style.display = 'block';
      }
    }
  }

  // 填充规则表单
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
    } else if (rule.type === 'answer-upload') {
      document.getElementById('urlUpload').value = rule.urlUpload || '';
      document.getElementById('uploadType').value = rule.uploadType || 'original';
      document.getElementById('serverLocate').value = rule.serverLocate || '';
    }

    let maxTriggersInput;
    if (rule.type === 'content-change') {
      maxTriggersInput = document.querySelector('#contentChangeMaxTriggers');
    } else if (rule.type === 'zip-implant') {
      maxTriggersInput = document.querySelector('#zipImplantMaxTriggers');
    } else if (rule.type === 'answer-upload') {
      maxTriggersInput = document.querySelector('#answerUploadMaxTriggers');
    }

    if (maxTriggersInput) {
      maxTriggersInput.value = rule.maxTriggers || '';
    }
  }

  // 保存规则
  async saveRule() {
    const form = document.getElementById('ruleForm');

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
      this.logManager.addErrorLog('请输入规则名称');
      return;
    }

    if (!rule.type) {
      this.logManager.addErrorLog('请选择规则类型');
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
        this.logManager.addErrorLog('请输入URL匹配模式');
        return;
      }
    } else if (rule.type === 'zip-implant') {
      rule.urlFileinfo = document.getElementById('urlFileinfo').value.trim();
      rule.urlZip = document.getElementById('urlZip').value.trim();
      rule.targetFileName = document.getElementById('targetFileName').value.trim();
      rule.zipImplant = document.getElementById('zipImplant').value.trim();

      if (!rule.urlZip) {
        this.logManager.addErrorLog('请输入ZIP文件URL匹配');
        return;
      }

      if (!rule.zipImplant) {
        this.logManager.addErrorLog('请选择注入ZIP文件');
        return;
      }
    } else if (rule.type === 'answer-upload') {
      rule.urlUpload = document.getElementById('urlUpload').value.trim();
      rule.uploadType = document.getElementById('uploadType').value;
      rule.serverLocate = document.getElementById('serverLocate').value.trim();

      if (!rule.urlUpload) {
        this.logManager.addErrorLog('请输入上传URL匹配');
        return;
      }
    }

    let maxTriggersInput;
    const ruleType = document.getElementById('ruleType').value;

    if (ruleType === 'content-change') {
      maxTriggersInput = document.querySelector('#contentChangeMaxTriggers');
    } else if (ruleType === 'zip-implant') {
      maxTriggersInput = document.querySelector('#zipImplantMaxTriggers');
    } else if (ruleType === 'answer-upload') {
      maxTriggersInput = document.querySelector('#answerUploadMaxTriggers');
    }

    const maxTriggersValue = maxTriggersInput ? maxTriggersInput.value.trim() : '';

    if (maxTriggersValue && parseInt(maxTriggersValue) > 0) {
      rule.maxTriggers = parseInt(maxTriggersValue);
      rule.currentTriggers = 0;
      console.log('设置触发次数限制:', rule.maxTriggers);
    } else {
      delete rule.maxTriggers;
      delete rule.currentTriggers;
      console.log('移除触发次数限制');
    }

    console.log('准备保存规则:', rule);

    try {
      // 调用后端API保存规则
      const result = await window.electronAPI.saveRule(rule);

      console.log('保存规则结果:', result);

      if (result && result.success) {
        this.logManager.addSuccessLog(this.state.currentEditingRule ? '规则更新成功' : '规则添加成功');
        this.hideRuleModal();
        this.loadRules();
      } else {
        this.logManager.addErrorLog('保存规则失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (error) {
      console.error('保存规则失败:', error);
      this.logManager.addErrorLog('保存规则失败: ' + error.message);
    }
  }

  // 加载规则
  async loadRules() {
    try {
      const rules = await window.electronAPI.getRules();
      this.displayRules(rules);
    } catch (error) {
      this.logManager.addErrorLog(`加载规则失败: ${error.message}`);
      this.displayRules([]);
    }
  }

  // 显示规则
  displayRules(rules) {
    const rulesContent = document.querySelector('#rules-view .rules-content');
    const isSimple = document.documentElement.getAttribute('data-ui') === 'simple';

    if (!rules || rules.length === 0) {
      rulesContent.innerHTML = `
        <div class="no-rules">
          <i class="bi bi-collection"></i>
          <p>暂无规则集配置</p>
          <p class="text-muted">点击上方按钮添加新规则集</p>
        </div>
      `;
      return;
    }

    if (isSimple) {
      const ruleGroups = rules.filter(rule => rule.isGroup);
      if (ruleGroups.length === 0) {
        rulesContent.innerHTML = `
          <div class="no-rules">
            <i class="bi bi-collection"></i>
            <p>暂无规则集</p>
            <p class="text-muted">请到社区规则集安装</p>
          </div>
        `;
        return;
      }
      const html = ruleGroups.map(group => `
        <div class="rule-group simple-clickable-group${group.enabled ? ' simple-group-enabled' : ''}" data-group-id="${group.id}" onclick="universalAnswerFeature.enterSimpleRuleset('${group.id}')">
          <div class="rule-group-header">
            <div class="rule-group-info">
              <div class="rule-group-name">
                <i class="bi bi-collection"></i>
                ${group.name || '未命名规则集'}
              </div>
              ${group.description ? `<div class="rule-group-description">${group.description}</div>` : ''}
            </div>
            <div class="rule-group-actions">
              <button class="rule-btn delete-btn" onclick="event.stopPropagation();universalAnswerFeature.deleteSimpleRuleset('${group.id}')" title="删除规则集">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `).join('');
      rulesContent.innerHTML = `<div class="rules-list">${html}</div>`;
      return;
    }

    // 分离规则集和独立规则
    const ruleGroups = rules.filter(rule => rule.isGroup);
    const independentRules = rules.filter(rule => !rule.isGroup && !rule.groupId);

    let html = '<div class="rules-list">';

    // 显示规则集
    ruleGroups.forEach(group => {
      const groupRules = rules.filter(rule => rule.groupId === group.id);
      const statusClass = group.enabled ? 'enabled' : 'disabled';

      html += `
        <div class="rule-group" data-group-id="${group.id}">
          <div class="rule-group-header">
            <div class="rule-group-info">
              <div class="rule-group-name">
                <i class="bi bi-collection"></i>
                ${group.name || '未命名规则集'}
                <label class="rule-toggle">
                  <input type="checkbox" ${group.enabled ? 'checked' : ''} 
                         onchange="universalAnswerFeature.toggleRule('${group.id}', this.checked)">
                  <span class="rule-toggle-slider"></span>
                </label>
                <span class="rule-count">(${groupRules.length} 个规则)</span>
              </div>
              ${group.description ? `<div class="rule-group-description">${group.description}</div>` : ''}
              ${group.author ? `<div class="rule-group-author">作者: ${group.author}</div>` : ''}
            </div>
            <div class="rule-group-actions">
              <button class="rule-btn add-rule-btn" onclick="universalAnswerFeature.showRuleModal(null, '${group.id}')" title="添加规则">
                <i class="bi bi-plus"></i>
              </button>
              <button class="rule-btn edit-btn" onclick="universalAnswerFeature.editRuleGroup('${group.id}')" title="编辑规则集">
                <i class="bi bi-pencil"></i>
              </button>
              ${this.hasTriggersInGroup(groupRules) ? `
              <button class="rule-btn reset-btn" onclick="universalAnswerFeature.resetRuleTriggers('${group.id}')" title="重置触发次数">
                <i class="bi bi-arrow-clockwise"></i>
              </button>
              ` : ''}
              <button class="rule-btn delete-btn" onclick="universalAnswerFeature.deleteRule('${group.id}')" title="删除规则集">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <div class="rule-group-content">
            ${this.generateGroupRulesHtml(groupRules, group.enabled)}
          </div>
        </div>
      `;
    });

    // 显示独立规则
    if (independentRules.length > 0) {
      html += `
        <div class="rule-group independent-rules">
          <div class="rule-group-header">
            <div class="rule-group-info">
              <div class="rule-group-name">
                <i class="bi bi-list-ul"></i>
                独立规则
                <span class="rule-count">(${independentRules.length} 个规则)</span>
              </div>
            </div>
          </div>
          <div class="rule-group-content">
            ${this.generateGroupRulesHtml(independentRules, true)}
          </div>
        </div>
      `;
    }

    html += '</div>';
    rulesContent.innerHTML = html;
  }

  // 检查规则组是否有触发次数限制
  hasTriggersInGroup(rules) {
    return rules && rules.some(rule => rule.maxTriggers !== undefined && rule.maxTriggers > 0);
  }

  // 生成规则组HTML
  generateGroupRulesHtml(rules, parentGroupEnabled = true) {
    if (!rules || rules.length === 0) {
      return `
        <div class="no-group-rules">
          <i class="bi bi-info-circle"></i>
          <span>暂无规则</span>
        </div>
      `;
    }

    let html = '';
    rules.forEach(rule => {
      // 规则的有效状态：规则本身启用 且 父规则集启用（如果有的话）
      const isEffective = rule.enabled && parentGroupEnabled;
      const statusClass = isEffective ? 'enabled' : 'disabled';
      const typeClass = rule.type ? rule.type.replace('-', '') : '';

      // 如果父规则集被禁用，子规则的开关应该显示为禁用状态
      const isDisabledByParent = !parentGroupEnabled;

      html += `
        <div class="rule-item ${statusClass}" data-rule-id="${rule.id}">
          <div class="rule-header">
            <div class="rule-info">
              <div class="rule-name">
                ${rule.name || '未命名规则'}
                <label class="rule-toggle ${isDisabledByParent ? 'disabled-by-parent' : ''}">
                  <input type="checkbox" ${rule.enabled ? 'checked' : ''} 
                         ${isDisabledByParent ? 'disabled' : ''}
                         onchange="universalAnswerFeature.toggleRule('${rule.id}', this.checked)"
                         title="${isDisabledByParent ? '规则集已禁用，无法单独启用此规则' : ''}">
                  <span class="rule-toggle-slider"></span>
                </label>
              </div>
              ${rule.description ? `<div class="rule-description">${rule.description}</div>` : ''}
            </div>
            <div class="rule-actions">
              <button class="rule-btn edit-btn" onclick="universalAnswerFeature.editRule('${rule.id}')" title="编辑">
                <i class="bi bi-pencil"></i>
              </button>
              ${rule.maxTriggers ? `
              <button class="rule-btn reset-btn" onclick="universalAnswerFeature.resetRuleTriggers('${rule.id}')" title="重置触发次数">
                <i class="bi bi-arrow-clockwise"></i>
              </button>
              ` : ''}
              <button class="rule-btn delete-btn" onclick="universalAnswerFeature.deleteRule('${rule.id}')" title="删除">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <div class="rule-config">
            ${this.formatRuleConfig(rule)}
          </div>
        </div>
      `;
    });

    return html;
  }

  // 编辑规则集
  async editRuleGroup(groupId) {
    try {
      const rules = await window.electronAPI.getRules();
      const group = rules.find(r => r.id === groupId && r.isGroup);
      if (group) {
        this.showRuleGroupModal(group);
      } else {
        this.logManager.addErrorLog('规则集不存在');
      }
    } catch (error) {
      console.error('获取规则集失败:', error);
      this.logManager.addErrorLog('获取规则集失败: ' + error.message);
    }
  }

  // 获取规则类型文本
  getRuleTypeText(type) {
    const typeMap = {
      'content-change': '内容修改',
      'zip-implant': 'ZIP注入',
      'answer-upload': '答案上传'
    };
    return typeMap[type] || type || '未知类型';
  }

  // 格式化规则配置
  formatRuleConfig(rule) {
    let html = '<div class="config-items">';

    if (rule.type === 'content-change') {
      html += `
        <div class="config-item">
          <span class="config-label">URL匹配:</span>
          <span class="config-value">${rule.urlPattern || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">修改类型:</span>
          <span class="config-value">${this.getChangeTypeLabel(rule.changeType)}</span>
        </div>
        <div class="config-item">
          <span class="config-label">原始内容:</span>
          <span class="config-value">${rule.originalContent || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">新内容:</span>
          <span class="config-value">${rule.newContent || '未设置'}</span>
        </div>
        ${rule.maxTriggers ? `
        <div class="config-item">
          <span class="config-label">触发次数:</span>
          <span class="config-value">${rule.currentTriggers || 0}/${rule.maxTriggers}</span>
        </div>
        ` : ''}
      `;
    } else if (rule.type === 'zip-implant') {
      html += `
        <div class="config-item">
          <span class="config-label">文件信息URL匹配:</span>
          <span class="config-value">${rule.urlFileinfo || '未设置（匹配所有fileinfo请求）'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">ZIP URL匹配:</span>
          <span class="config-value">${rule.urlZip || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">目标文件名:</span>
          <span class="config-value">${rule.targetFileName || '未设置（匹配所有文件）'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">注入文件:</span>
          <span class="config-value">${rule.zipImplant || '未设置'}</span>
        </div>
        ${rule.maxTriggers ? `
        <div class="config-item">
          <span class="config-label">触发次数:</span>
          <span class="config-value">${rule.currentTriggers || 0}/${rule.maxTriggers}</span>
        </div>
        ` : ''}
      `;
    } else if (rule.type === 'answer-upload') {
      html += `
        <div class="config-item">
          <span class="config-label">上传URL匹配:</span>
          <span class="config-value">${rule.urlUpload || '未设置'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">上传类型:</span>
          <span class="config-value">${rule.uploadType === 'original' ? '原始数据' : '提取的答案'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">服务器位置:</span>
          <span class="config-value">${rule.serverLocate || '未设置'}</span>
        </div>
        ${rule.maxTriggers ? `
        <div class="config-item">
          <span class="config-label">触发次数:</span>
          <span class="config-value">${rule.currentTriggers || 0}/${rule.maxTriggers}</span>
        </div>
        ` : ''}
      `;
    }

    html += '</div>';
    return html;
  }

  // 获取修改类型标签
  getChangeTypeLabel(changeType) {
    const labels = {
      'request-body': '请求体',
      'response-body': '响应体',
      'request-headers': '请求头',
      'response-headers': '响应头'
    };
    return labels[changeType] || changeType || '未设置';
  }

  // 编辑规则
  async editRule(ruleId) {
    try {
      const rules = await window.electronAPI.getRules();
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        this.showRuleModal(rule);
      } else {
        this.logManager.addErrorLog('规则不存在');
      }
    } catch (error) {
      this.logManager.addErrorLog(`加载规则失败: ${error.message}`);
    }
  }

  // 删除规则
  async deleteRule(ruleId) {
    if (!confirm('确定要删除这个规则吗？此操作不可撤销。')) {
      return;
    }

    try {
      const result = await window.electronAPI.deleteRule(ruleId);
      if (result.success) {
        this.logManager.addSuccessLog('规则删除成功');
        this.loadRules(); // 重新加载规则列表
        this.renderSimpleHomeRulesets().catch(() => {})
      } else {
        this.logManager.addErrorLog(`规则删除失败: ${result.error}`);
      }
    } catch (error) {
      this.logManager.addErrorLog(`规则删除失败: ${error.message}`);
    }
  }

  // 重置规则触发次数
  async resetRuleTriggers(ruleId) {
    if (!confirm('确定要重置此规则的触发次数吗？')) {
      return;
    }

    try {
      const result = await window.electronAPI.resetRuleTriggers(ruleId);
      if (result.success) {
        this.logManager.addSuccessLog('触发次数重置成功');
        this.loadRules();
      } else {
        this.logManager.addErrorLog(`触发次数重置失败: ${result.error}`);
      }
    } catch (error) {
      this.logManager.addErrorLog(`触发次数重置失败: ${error.message}`);
    }
  }

  // 切换规则状态
  async toggleRule(ruleId, enabled) {
    try {
      const result = await window.electronAPI.toggleRule(ruleId, enabled);
      if (result.success) {
        this.logManager.addSuccessLog(`规则已${enabled ? '启用' : '禁用'}`);

        // 检查是否是规则集，如果是规则集则重新加载整个列表以更新子规则状态
        const rules = await window.electronAPI.getRules();
        const toggledRule = rules.find(r => r.id === ruleId);

        if (toggledRule && toggledRule.isGroup) {
          // 如果是规则集，重新加载整个规则列表
          this.loadRules();
        } else {
          // 如果是普通规则，只更新状态显示
          this.updateRuleStatus(ruleId, enabled);
        }
      } else {
        this.logManager.addErrorLog(`规则状态更新失败: ${result.error}`);
        // 恢复开关状态
        const checkbox = document.querySelector(`input[onchange*="${ruleId}"]`);
        if (checkbox) {
          checkbox.checked = !enabled;
        }
      }
    } catch (error) {
      this.logManager.addErrorLog(`规则状态更新失败: ${error.message}`);
      // 恢复开关状态
      const checkbox = document.querySelector(`input[onchange*="${ruleId}"]`);
      if (checkbox) {
        checkbox.checked = !enabled;
      }
    }
  }

  // 更新规则状态显示
  updateRuleStatus(ruleId, enabled) {
    const ruleItem = document.querySelector(`input[onchange*="${ruleId}"]`)?.closest('.rule-item');
    if (ruleItem) {
      const statusSpan = ruleItem.querySelector('.rule-status');
      if (statusSpan) {
        statusSpan.textContent = enabled ? '已启用' : '已禁用';
        statusSpan.className = `rule-status ${enabled ? 'enabled' : 'disabled'}`;
      }
      ruleItem.className = `rule-item ${enabled ? 'enabled' : 'disabled'}`;
    }
  }

  // 浏览ZIP文件
  browseZipFile() {
    window.electronAPI.openImplantZipChoosing();
  }

  // 进入简单模式规则集
  async enterSimpleRuleset(groupId) {
    await this.applyExclusiveRuleset(groupId);
    document.documentElement.setAttribute('data-ui', 'simple');
    document.documentElement.setAttribute('data-simple-page', 'app');
    this.state.switchView('answers');
  }

  // 应用排他规则集
  async applyExclusiveRuleset(groupId) {
    let rules;
    try {
      rules = await window.electronAPI.getRules();
    } catch (e) {
      this.logManager.addErrorLog(`读取规则失败: ${e.message}`);
      return;
    }
    const target = rules.find((r) => r.isGroup && r.id === groupId);
    if (!target) {
      this.logManager.addErrorLog('未找到该规则集');
      return;
    }
    let changed = false;
    const updated = rules.map((r) => {
      if (!r.isGroup) {
        return r;
      }
      const enabled = r.id === groupId;
      if (r.enabled !== enabled) {
        changed = true;
        return { ...r, enabled };
      }
      return r;
    });
    if (changed) {
      const res = await window.electronAPI.saveResponseRules(updated);
      if (!res || !res.success) {
        this.logManager.addErrorLog('保存规则集开关失败');
        return;
      }
      this.logManager.addSuccessLog(`已启用规则集：${target.name || groupId}`);
    }
    const ui = document.documentElement.getAttribute('data-ui');
    await this.renderSimpleHomeRulesets();
    if (ui === 'simple' && this.state.currentView === 'rules') {
      await this.loadRules();
    }
  }

  // 渲染简单模式主页规则集
  async renderSimpleHomeRulesets() {
    if (document.documentElement.getAttribute('data-ui') !== 'simple') {
      return;
    }
    const grid = document.getElementById('simple-ruleset-grid');
    const emptyEl = document.getElementById('simple-ruleset-empty');
    if (!grid) {
      return;
    }
    let rules;
    try {
      rules = await window.electronAPI.getRules();
    } catch (e) {
      grid.innerHTML = '';
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '无法加载规则集列表';
      }
      return;
    }
    const groups = rules.filter((r) => r.isGroup);
    if (groups.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = '暂无已安装的规则集，请在专业模式下从社区安装或导入。';
      }
      return;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
    grid.innerHTML = groups.map((g) => {
      const name = Utils.escapeHtml(g.name || '未命名规则集');
      const desc = Utils.escapeHtml(g.description || '无描述');
      const gid = g.id;
      const active = g.enabled ? ' feature-card--active' : '';
      return `<div class="feature-card${active}" data-group-id="${gid}"><h3>${name}</h3><p>${desc}</p></div>`;
    }).join('');
    grid.querySelectorAll('.feature-card').forEach((card) => {
      card.addEventListener('click', () => {
        const gid = card.getAttribute('data-group-id');
        if (gid) {
          this.enterSimpleRuleset(gid);
        }
      });
    });
  }

  // 删除简单模式规则集
  async deleteSimpleRuleset(groupId) {
    if (!confirm('确定删除这个规则集吗？这会同时删除规则集中的规则。')) {
      return;
    }
    try {
      const result = await window.electronAPI.deleteRule(groupId);
      if (result && result.success) {
        this.logManager.addSuccessLog('规则集删除成功');
        await this.renderSimpleHomeRulesets();
        if (this.state.currentView === 'rules') {
          await this.loadRules();
        }
      } else {
        this.logManager.addErrorLog(`规则集删除失败: ${result ? result.error : '未知错误'}`);
      }
    } catch (error) {
      this.logManager.addErrorLog(`规则集删除失败: ${error.message}`);
    }
  }
}

export default RulesUI;
