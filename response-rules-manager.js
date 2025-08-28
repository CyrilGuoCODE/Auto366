// 响应体规则管理器
class ResponseRulesManager {
    constructor() {
        this.rules = [];
        this.modal = null;
        this.rulesList = null;
        this.init();
    }

    init() {
        this.modal = document.getElementById('response-rules-modal');
        this.rulesList = document.getElementById('rules-list');

        // 绑定事件
        this.bindEvents();

        // 加载已保存的规则
        this.loadRules();
    }

    bindEvents() {
        // 打开规则配置弹窗
        document.getElementById('responseRulesBtn').addEventListener('click', () => {
            this.showModal();
        });

        // 关闭弹窗
        document.getElementById('close-response-rules').addEventListener('click', () => {
            this.hideModal();
        });

        // 点击弹窗外部关闭
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hideModal();
            }
        });

        // 添加规则
        document.getElementById('add-rule-btn').addEventListener('click', () => {
            this.addRule();
        });

        // 清空所有规则
        document.getElementById('clear-all-rules-btn').addEventListener('click', () => {
            if (confirm('确定要清空所有规则吗？')) {
                this.clearAllRules();
            }
        });

        // 保存规则
        document.getElementById('save-rules-btn').addEventListener('click', () => {
            this.saveRules();
        });

        // 取消
        document.getElementById('cancel-rules-btn').addEventListener('click', () => {
            this.hideModal();
        });
    }

    async loadRules() {
        try {
            this.rules = await window.electronAPI.getResponseRules() || [];
            this.renderRules();
        } catch (error) {
            console.error('加载规则失败:', error);
            this.rules = [];
            this.renderRules();
        }
    }

    async saveRules() {
        try {
            // 收集所有规则数据
            const rules = this.collectRulesData();

            // 验证规则
            const validation = this.validateRules(rules);
            if (!validation.valid) {
                alert('规则验证失败：' + validation.message);
                return;
            }

            // 保存到后端
            const result = await window.electronAPI.saveResponseRules(rules);
            if (result.success) {
                this.rules = rules;
                alert('规则保存成功！');
                this.hideModal();
            } else {
                alert('保存失败：' + result.error);
            }
        } catch (error) {
            console.error('保存规则失败:', error);
            alert('保存失败：' + error.message);
        }
    }

    collectRulesData() {
        const ruleItems = this.rulesList.querySelectorAll('.rule-item');
        const rules = [];

        ruleItems.forEach((item, index) => {
            // 获取修改类型
            const modifyTypeElement = item.querySelector('[name="modifyType"]');
            const modifyType = modifyTypeElement ? modifyTypeElement.value : 'replace';

            // 根据修改类型获取相应的字段
            const rule = {
                id: Date.now() + index,
                name: (item.querySelector('[name="name"]')?.value || `规则${index + 1}`).trim(),
                enabled: item.querySelector('.rule-toggle')?.classList.contains('enabled') || false,
                urlPattern: (item.querySelector('[name="urlPattern"]')?.value || '').trim(),
                matchType: (item.querySelector('[name="matchType"]')?.value || 'contains'),
                method: (item.querySelector('[name="method"]')?.value || 'ALL'),
                modifyType: modifyType
            };

            // 根据修改类型添加相应的字段
            if (modifyType === 'replace' || modifyType === 'prepend' || modifyType === 'append') {
                rule.newContent = (item.querySelector('[name="newContent"]')?.value || '').trim();
            } else if (modifyType === 'find_replace') {
                rule.findText = (item.querySelector('[name="findText"]')?.value || '').trim();
                rule.replaceText = (item.querySelector('[name="replaceText"]')?.value || '').trim();
                rule.useRegex = item.querySelector('[name="useRegex"]')?.checked || false;
                rule.regexFlags = (item.querySelector('[name="regexFlags"]')?.value || 'g').trim();
            }

            rules.push(rule);
        });

        return rules;
    }

    validateRules(rules) {
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];

            if (!rule.name.trim()) {
                return { valid: false, message: `第${i + 1}个规则名称不能为空` };
            }

            if (!rule.urlPattern.trim()) {
                return { valid: false, message: `第${i + 1}个规则URL匹配模式不能为空` };
            }

            if (rule.matchType === 'regex') {
                try {
                    new RegExp(rule.urlPattern);
                } catch (e) {
                    return { valid: false, message: `第${i + 1}个规则正则表达式格式错误` };
                }
            }

            if (rule.modifyType === 'find_replace') {
                if (!rule.findText.trim()) {
                    return { valid: false, message: `第${i + 1}个规则查找文本不能为空` };
                }

                if (rule.useRegex) {
                    try {
                        new RegExp(rule.findText, rule.regexFlags);
                    } catch (e) {
                        return { valid: false, message: `第${i + 1}个规则查找正则表达式格式错误` };
                    }
                }
            }
        }

        return { valid: true };
    }

    showModal() {
        this.modal.style.display = 'flex';
        this.renderRules();
    }

    hideModal() {
        this.modal.style.display = 'none';
    }

    addRule() {
        const newRule = {
            id: Date.now(),
            name: `规则${this.rules.length + 1}`,
            enabled: true,
            urlPattern: '',
            matchType: 'contains',
            method: 'ALL',
            modifyType: 'replace',
            newContent: '',
            findText: '',
            replaceText: '',
            useRegex: false,
            regexFlags: 'g'
        };

        this.rules.push(newRule);
        this.renderRules();
    }

    clearAllRules() {
        this.rules = [];
        this.renderRules();
    }

    deleteRule(index) {
        if (confirm('确定要删除这个规则吗？')) {
            this.rules.splice(index, 1);
            this.renderRules();
        }
    }

    toggleRule(index) {
        this.rules[index].enabled = !this.rules[index].enabled;
        this.renderRules();
    }

    renderRules() {
        if (this.rules.length === 0) {
            this.rulesList.innerHTML = '<div class="no-rules">暂无规则，点击"添加规则"开始配置</div>';
            return;
        }

        this.rulesList.innerHTML = this.rules.map((rule, index) => this.renderRule(rule, index)).join('');

        // 绑定规则项事件
        this.bindRuleEvents();
    }

    renderRule(rule, index) {
        return `
      <div class="rule-item" data-index="${index}">
        <div class="rule-header">
          <div class="rule-title">规则 ${index + 1}</div>
          <div class="rule-actions">
            <button class="rule-toggle ${rule.enabled ? 'enabled' : 'disabled'}" onclick="responseRulesManager.toggleRule(${index})">
              ${rule.enabled ? '启用' : '禁用'}
            </button>
            <button class="rule-delete" onclick="responseRulesManager.deleteRule(${index})">删除</button>
          </div>
        </div>
        
        <div class="rule-form">
          <div class="form-group">
            <label>规则名称</label>
            <input type="text" name="name" value="${rule.name}" placeholder="输入规则名称">
          </div>
          
          <div class="form-group">
            <label>匹配方式</label>
            <select name="matchType">
              <option value="contains" ${rule.matchType === 'contains' ? 'selected' : ''}>包含</option>
              <option value="exact" ${rule.matchType === 'exact' ? 'selected' : ''}>完全匹配</option>
              <option value="regex" ${rule.matchType === 'regex' ? 'selected' : ''}>正则表达式</option>
            </select>
          </div>
          
          <div class="form-group full-width">
            <label>URL匹配模式</label>
            <input type="text" name="urlPattern" value="${rule.urlPattern}" placeholder="输入URL匹配模式">
            <div class="rule-match-info">
              ${rule.matchType === 'contains' ? '匹配包含此文本的URL' :
                rule.matchType === 'exact' ? '完全匹配此URL' :
                    '使用正则表达式匹配URL'}
            </div>
          </div>
          
          <div class="form-group">
            <label>请求方法</label>
            <select name="method">
              <option value="ALL" ${rule.method === 'ALL' ? 'selected' : ''}>所有方法</option>
              <option value="GET" ${rule.method === 'GET' ? 'selected' : ''}>GET</option>
              <option value="POST" ${rule.method === 'POST' ? 'selected' : ''}>POST</option>
              <option value="PUT" ${rule.method === 'PUT' ? 'selected' : ''}>PUT</option>
              <option value="DELETE" ${rule.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>修改方式</label>
            <select name="modifyType" onchange="responseRulesManager.onModifyTypeChange(this, ${index})">
              <option value="replace" ${rule.modifyType === 'replace' ? 'selected' : ''}>完全替换</option>
              <option value="find_replace" ${rule.modifyType === 'find_replace' ? 'selected' : ''}>查找替换</option>
              <option value="prepend" ${rule.modifyType === 'prepend' ? 'selected' : ''}>前置添加</option>
              <option value="append" ${rule.modifyType === 'append' ? 'selected' : ''}>后置添加</option>
            </select>
          </div>
          
          ${this.renderModifyOptions(rule, index)}
        </div>
      </div>
    `;
    }

    renderModifyOptions(rule, index) {
        switch (rule.modifyType) {
            case 'replace':
            case 'prepend':
            case 'append':
                return `
          <div class="form-group full-width">
            <label>${rule.modifyType === 'replace' ? '新内容' : rule.modifyType === 'prepend' ? '前置内容' : '后置内容'}</label>
            <textarea name="newContent" placeholder="输入${rule.modifyType === 'replace' ? '替换' : '添加'}的内容">${rule.newContent}</textarea>
          </div>
        `;
                break;

            case 'find_replace':
                return `
          <div class="form-group">
            <label>查找文本</label>
            <textarea name="findText" placeholder="输入要查找的文本">${rule.findText}</textarea>
          </div>
          
          <div class="form-group">
            <label>替换文本</label>
            <textarea name="replaceText" placeholder="输入替换的文本">${rule.replaceText}</textarea>
          </div>
          
          <div class="form-group">
            <label>
              <input type="checkbox" name="useRegex" ${rule.useRegex ? 'checked' : ''}>
              使用正则表达式
            </label>
          </div>
          
          <div class="form-group">
            <label>正则标志</label>
            <input type="text" name="regexFlags" value="${rule.regexFlags}" placeholder="如: g, i, m">
          </div>
        `;
                break;

            default:
                return '';
        }
    }

    onModifyTypeChange(select, index) {
        this.renderRules();
    }

    bindRuleEvents() {
    }
}

let responseRulesManager;

document.addEventListener('DOMContentLoaded', () => {
    responseRulesManager = new ResponseRulesManager();
});