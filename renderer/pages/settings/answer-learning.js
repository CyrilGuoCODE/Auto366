import createModuleClient from '../../services/module-client.js';

export default function initAnswerLearning() {
  const panel = document.getElementById('answerLearningSettings');
  if (!panel) return;
  const client = createModuleClient('answer-learning');
  panel.innerHTML = `<h4 class="settings-entry__label">AI 答案获取</h4>
    <div class="settings-entry__body">
    <label class="answer-learning__toggle"><input id="answerLearningEnabled" type="checkbox" data-enabled> 自动识别未支持的题型</label>
    <p class="setting-item__description">开启后自动捕获合适的题目响应及 ZIP 内未识别的文本，将脱敏后的请求和响应发送给上方选定的 AI，生成并验证规则。脱敏不能保证去除所有个人信息。无需手动采样；新规则需核对答案后启用。它不会主动打开题目或重发提交，也不会补造响应中不存在的答案。</p>
    <label class="answer-learning__toggle"><input type="checkbox" data-heuristic> 启发式发现新题型</label>
    <p class="setting-item__description">结合题目结构、选项标记与路径发现候选；关闭后只寻找明确的答案字段。已启用规则仍可复用。</p>
    <label class="answer-learning__toggle"><input type="checkbox" data-share> 确认启用后自动提交规则供审核</label>
    <p class="setting-item__description" data-cloud></p>
    <p class="answer-learning__status" role="status" aria-live="polite" data-status>正在读取设置…</p>
    <details class="answer-learning__discovery"><summary data-sample-count>临时样本</summary>
      <p class="setting-item__description">最多保留 8 条样本，约 5 分钟后自动清除；原始采样不写入磁盘。设置、规则与同步状态分区保存在用户目录的 .Auto366/answer-policies.json。</p>
      <ul data-candidates></ul><button class="btn--ghost" data-clear>清除临时样本</button>
    </details>
    <div class="answer-learning__section"><label for="learningRecords">已生成的规则</label>
      <select id="learningRecords" class="form-input" data-records></select>
      <p class="setting-item__description" data-empty>开启自动识别后，正常打开题目；生成的规则和答案预览会显示在这里。</p>
      <pre class="answer-learning__preview" data-preview></pre>
      <div class="answer-learning__actions">
        <button class="btn--primary" data-action="approve">答案正确，启用规则</button>
        <button class="btn--ghost" data-action="disable">停用</button>
        <button class="btn--danger" data-action="delete">删除</button>
      </div>
      <details data-rule-details><summary>查看请求匹配正则</summary><pre class="answer-learning__preview" data-pattern></pre></details>
    </div></div>`;
  const $ = selector => panel.querySelector(selector);
  let state = { records: [] }, busy = false, refreshPending = false;
  function paint() {
    const record = state.records.find(record => record.id === $('[data-records]').value);
    $('[data-enabled]').checked = !!(state.enabled && state.autoGenerate);
    $('[data-share]').checked = !!state.autoShare;
    $('[data-heuristic]').checked = state.heuristic !== false;
    $('[data-records]').hidden = !state.records.length;
    $('[data-empty]').hidden = !!record;
    $('[data-preview]').hidden = !record;
    $('.answer-learning__actions').hidden = !record;
    $('[data-rule-details]').hidden = !record;
    $('[data-preview]').textContent = record?.review
      ? record.review.answers.map((answer, index) => `${index + 1}. ${answer.answer}`).join('\n')
      : record ? '暂无有效预览。正常打开对应题目后会自动验证；请勿仅凭规则名称判断答案正确。' : '正常打开题目即可；有可用规则时会在这里显示。';
    $('[data-pattern]').textContent = record ? (record.entry ? 'ZIP 内文件：' + record.entry + '\n' : '') + record.pattern : '';
    for (const button of panel.querySelectorAll('[data-action]')) {
      button.disabled = busy || !record || (button.dataset.action === 'approve' && (!record.review || record.enabled));
    }
    panel.querySelectorAll('input,select').forEach(control => { control.disabled = busy; });
    $('[data-share]').disabled = busy || !state.cloudConfigured;
    $('[data-heuristic]').disabled = busy;
    $('[data-clear]').disabled = busy || !state.samples?.length && !state.records.some(item => item.review);
    if (record?.shareError) $('[data-status]').textContent = '规则已在本地启用，共享提交失败：' + record.shareError;
  }
  async function refresh() {
    const next = await client.call('status');
    state = next;
    const select = $('[data-records]'), selected = select.value;
    select.replaceChildren(...state.records.map(record => {
      const option = document.createElement('option'); option.value = record.id;
      option.textContent = `${record.blockedReason ? '已隔离' : record.enabled ? '已启用' : record.review ? '待确认' : '已停用/等待题目'} · ${record.questionType} · ${record.id.slice(0, 8)}`;
      return option;
    }));
    if (!state.records.length) { const option = document.createElement('option'); option.textContent = '暂无规则'; option.value = ''; select.append(option); }
    if (state.records.some(record => record.id === selected)) select.value = selected;
    $('[data-enabled]').checked = !!(state.enabled && state.autoGenerate);
    $('[data-share]').checked = !!state.autoShare;
    $('[data-heuristic]').checked = state.heuristic !== false;
    $('[data-sample-count]').textContent = `临时样本 ${state.samples.length} / 8${state.pending ? ' · 排队 ' + state.pending : ''}`;
    $('[data-candidates]').replaceChildren(...state.samples.map(sample => {
      const item = document.createElement('li');
      item.textContent = `${sample.label} · ${sample.reasons?.join('、') || '用于验证已有规则'}`;
      return item;
    }));
    $('[data-cloud]').textContent = state.cloudConfigured ? '只提交已确认的规则，不上传捕获正文；候选需经服务器审核后才能共享。' : '共享服务尚未配置，自动识别和本地使用不受影响。';
    $('[data-status]').textContent = state.activity || '等待题目响应';
    paint();
  }
  async function run(action) {
    if (busy) return;
    busy = true; paint();
    try { await action(); await refresh(); }
    catch (error) { $('[data-status]').textContent = error.message; }
    finally { busy = false; paint(); }
  }
  $('[data-enabled]').addEventListener('change', event => { const checked = event.target.checked; run(() => client.call('enabled', checked)); });
  $('[data-heuristic]').addEventListener('change', event => { const checked = event.target.checked; run(() => client.call('heuristic', checked)); });
  $('[data-clear]').addEventListener('click', () => run(() => client.call('clear-samples')));
  $('[data-share]').addEventListener('change', event => { const checked = event.target.checked; run(() => client.call('auto-share', checked)); });
  $('[data-records]').addEventListener('change', paint);
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const record = state.records.find(record => record.id === $('[data-records]').value);
    if (record) run(() => client.call(action, action === 'approve' ? record.review?.token : record.id));
  });
  client.on('changed', () => {
    if (refreshPending) return;
    refreshPending = true;
    setTimeout(() => { refreshPending = false; if (!busy) refresh().catch(error => { $('[data-status]').textContent = error.message; }); }, 150);
  });
  refresh().catch(error => { $('[data-status]').textContent = error.message; });
}
