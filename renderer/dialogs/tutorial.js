import settingsStorage from '../services/settings.js';

const QUESTIONS = [
  { title: '第一次使用新版天学网，应按什么顺序连接？', options: ['只在天学网里填写手动代理，保持增强模式关闭', '先启动 Auto366 代理，确认已启动，再开启闪电按钮对应的增强模式', '直接打开题目，等没有答案时再随意改端口'], correct: 1, explanation: '新版天学网必须使用增强模式。先确认代理已启动，再确认增强模式已开启、接入列表包含实际运行的天学网进程，最后重新打开题目。仅点击开关不代表接入成功。' },
  { title: '已配置好的功能突然异常、题目打不开或没有新的答案，首先怎样处理？', options: ['马上同时开启所有规则集', '先反复修改端口、重置证书并删除所有配置', '优先使用顶部「清理缓存」，在确认区短按「清理并重启」，重启后重新打开题目'], correct: 2, explanation: '先确认缓存目录是天学网实际使用的 Up366StudentFiles，并结束正在进行的作答。优先清缓存并重启，让题目重新下载；仍有问题时，再检查版本、代理、增强模式、对应规则和日志，不要重复盲目清理。' },
  { title: 'AI 已生成匹配规则，并在设置页显示了一组答案，什么时候可以启用？', options: ['逐项核对题型、题目顺序和答案内容，确认正确后再启用', '只要生成成功就直接启用，无需看答案', '只要规则名称和当前题型相同就启用'], correct: 0, explanation: '正则匹配成功只说明抓到了文本，不保证抓到的是正确答案或顺序正确。请先核对预览；规则启用后会在后续适用响应中复用，错误规则应停用。' },
  { title: '首次配置缓存目录，怎样寻找并确认路径？', options: ['选择 Auto366 的安装目录', '优先点击「自动寻找」，确认是正在使用的 Up366StudentFiles；未找到时再点「浏览」', '选择任意空文件夹，软件会自动补齐天学网缓存'], correct: 1, explanation: '缓存路径属于天学网，不是 Auto366。自动寻找可能找不到或发现多个目录，要确认与当前天学网对应；路径错误会导致清理无效，也不应随意指定其他目录。' },
  { title: '准备做某一种题型时，规则集应该怎样开启？', options: ['只开启适用规则，保留兼容性保护，然后重新打开题目', '把内置和扩展规则全部开启，数量越多越可靠', '只要已安装规则，就不需要开启或重新进入题目'], correct: 0, explanation: '规则之间可能修改同一响应，全部开启会产生冲突。简易模式点击卡片会启用该组并进入答案页；专业模式使用规则开关。切换后应重新打开题目产生新的响应。' },
  { title: '「启发式发现新题型」会怎样寻找未识别的答案？', options: ['主动遍历服务器上所有尚未访问的题目', '自动重发提交答案的请求来试探正确结果', '分析经过代理的新响应及 ZIP 内合适的文本，寻找原解析未覆盖的候选'], correct: 2, explanation: '它是被动分析，不自动打开题目，也不重放答题提交。ZIP 内文本受类型和大小限制；未解密的数据、未捕获的请求，以及响应中根本不存在的答案，都不能保证获取。' },
  { title: '打开 AI 答案获取开关前，应了解哪些数据会发送出去？', options: ['所有分析完全离线，没有数据离开本机', '生成规则需要把合适的脱敏请求和响应样本发送给所选 AI，脱敏可能不完整', '只会发送规则名称，绝不发送题目内容'], correct: 1, explanation: 'AI 生成规则依赖样本，样本仍可能包含题目或个人信息。自动共享是另一个独立开关，只提交确认后的规则供审核；开启 AI 获取不等于开启共享。' },
  { title: '设置里的「清除临时样本」与顶部「清理缓存」有什么区别？', options: ['前者清除 AI 内存样本和待确认预览，保留规则；后者清理实际缓存，并提供重启操作', '两个按钮完全相同，都能重启天学网', '清除临时样本会删除所有已保存的 AI 规则和软件设置'], correct: 0, explanation: '排查天学网运行异常时，优先用顶部的缓存清理和重启流程。「清除临时样本」仅管理 AI 样本，不会代替天学网缓存清理；新响应到达后可以重新采样。' },
  { title: '界面提示共享服务尚未配置，是否还能使用 AI 答案获取？', options: ['完全不能使用，必须等待社区共享上线', '可以直接信任任意来源的云端规则，无需验证', '仍可使用可用的 AI 服务生成、预览和保存本地规则'], correct: 2, explanation: 'AI 服务负责生成，规则共享服务负责审核和分发，两者独立。共享未配置不影响本地规则，但 AI 服务本身仍须可用，免费内置服务也可能限流或暂时失败。' },
  { title: '完成按钮导览和全部测验后，可以认为哪些事情已经完成？', options: ['代理、增强模式、AI 获取和全部规则均已自动开启', '已经学完使用流程；真正使用前仍需确认缓存、代理、增强模式和适用规则', '教程已替你清理缓存、重置证书并回退天学网版本'], correct: 1, explanation: '教程只要求学习、导航和答题，不会代替你执行清缓存、版本回退或服务启动。请根据实际状态操作，再打开题目。' },
  { title: '新版天学网已使用增强模式，清缓存并重启后仍报兼容或连接错误，下一步怎么做？', options: ['先回退旧版天学网，执行「还原天学网设置」，重启后再按先代理、后增强模式的顺序接入', '继续保留原有异常配置，只不停开关增强模式', '关闭增强模式，继续用新版的手动代理方式'], correct: 0, explanation: '按顺序处理：回退天学网旧版 → 还原天学网设置 → 重启天学网 → 启动 Auto366 代理 → 开启增强模式 → 重新打开题目。还原的是天学网设置，不是清除 Auto366 规则，也不是直接重置代理证书。' },
  { title: '点击顶部「清理缓存」后，怎样执行推荐的“清理并重启”？', options: ['直接关闭 Auto366，等待下次启动自动清理', '长按确认按钮直到切换为「仅执行清理」', '阅读日志区的确认提示，短按「清理并重启」，完成后再确认连接状态'], correct: 2, explanation: '顶部按钮先显示确认区，不会立即清理。短按确认按钮执行清理并重启；长按会切换成仅清理，不能把两种操作混淆。应先结束正在进行的作答，并确认缓存路径正确。' },
];

export default class TutorialManager {
  constructor(state, logManager) {
    this.state = state; this.logManager = logManager;
    this.currentPage = 0; this.visited = new Set(); this.passed = false;
  }
  init() {
    document.getElementById('replayTutorialBtn')?.addEventListener('click', () => this.showTutorial());
    document.addEventListener('agreement-accepted', () => this.maybeStart());
    this.maybeStart();
  }
  maybeStart() {
    if (document.getElementById('agreement-overlay')?.classList.contains('is-visible')) return;
    // 老用户不强制重学，可在设置中随时重开；未完成的新用户恢复上次步骤。
    if (settingsStorage.getItem('tutorial-completed') !== 'true') this.showTutorial(true);
  }
  navigation(view) {
    return document.documentElement.dataset.ui === 'simple' ? '#simple-open-' + view : `.sidebar__item[data-view="${view}"]`;
  }
  steps() {
    const simple = document.documentElement.dataset.ui === 'simple';
    return [
      { title: '欢迎使用 Auto366', text: '本教学将手把手带领你学习 Auto366 的使用。', welcome: true },
      { title: '打开设置', text: '点击高亮的「设置」。接下来先找到天学网的缓存目录。', selector: this.navigation('settings'), click: true },
      { title: '先用自动寻找', text: '配置缓存时，优先点「自动寻找」，确认找到的是天学网正在使用的 Up366StudentFiles。没有找到时，再用旁边的「浏览」手动选择。现在只需认识入口。', view: 'settings', selector: '#autoFindCacheBtn', acknowledge: true },
      { title: '启动代理', text: '使用时先点「启动代理」，等状态显示已启动。失败时查看日志中的端口或证书提示。教程中不用实际启动。', selector: '#toggleProxyBtn', acknowledge: true },
      { title: '新版天学网必须开启增强模式', text: '先确认代理已启动，再点高亮的闪电按钮开启增强模式。新版天学网必须使用此模式；确认接入列表包含天学网进程。首次可能需要下载资源和管理员权限。', selector: '#toggleTunBtn', acknowledge: true },
      { title: '打开规则集', text: '点击高亮的「规则集」。只开启当前题型需要的规则，保留兼容性保护。', selector: this.navigation('rules'), click: true },
      { title: simple ? '认识规则卡片' : '认识规则开关', text: simple ? '点击规则卡片会启用这一组并进入答案页。高亮只是位置示例，实际使用时按题型选择，不要全部开启。' : '名称右侧的开关控制整组规则，点击名称可展开子规则。高亮只是位置示例，实际使用时按题型选择，不要全部开启。', view: 'rules', selector: simple ? '#rules-view .rule-group--clickable .rule-group__name' : '#rules-view .rule-group__name .toggle', acknowledge: true },
      { title: '了解 AI 答案获取', text: '未支持的题型可在这里尝试 AI 获取。它会将脱敏样本发给所选 AI，仍可能含个人信息。新规则在这里预览，核对答案后才启用；此功能可选。', view: 'settings', selector: '#answerLearningEnabled', acknowledge: true },
      { title: '重新打开题目', text: '代理、接入和规则就绪后，点「打开天学网」进入题目。有新的响应才可能提取答案；已有缓存可能不发请求，响应也可能不含答案。', selector: '#openUp366Btn', acknowledge: true },
      { title: '查看答案', text: '点击高亮的「答案获取」。AI 新规则的待确认预览仍在设置页。', selector: this.navigation('answers'), click: true },
      { title: '确认获取开关', text: '打开题目前保持此开关开启，结果可复制或导出。遇到异常优先清缓存并重启；仍无结果时，再检查代理、增强模式、适用规则和此开关。', view: 'answers', selector: '#answers-view .view-panel__controls .toggle', acknowledge: true },
      { title: '遇到异常先清缓存并重启', text: '先结束正在进行的作答，确认缓存目录正确。点击顶部「清理缓存」，在日志区确认提示中短按「清理并重启」，之后重新打开题目；长按是仅清理。此处只学习入口，不必实际清理。', selector: '#clearCacheBtn', acknowledge: true },
      { title: '新版仍报错时，先回退并还原', text: '清缓存重启后仍报兼容或连接错误：先回退旧版天学网，执行「还原天学网设置」，重启天学网，再启动 Auto366 代理并开启高亮的增强模式。仍异常时查看日志，不要反复修改端口或重置证书。', selector: '#toggleTunBtn', acknowledge: true },
      { title: '使用前的小测验', text: '每题选一个答案，全部答对即可完成。答错后可根据提示修改。', quiz: true },
    ];
  }
  showTutorial(resume = false) {
    if (document.getElementById('agreement-overlay')?.classList.contains('is-visible')) return;
    this.hideTutorial(false, true);
    this.currentPage = resume && settingsStorage.getItem('tutorial-progress-version') === '5' ? Math.max(0, Math.min(Number(settingsStorage.getItem('tutorial-step')) || 0, this.steps().length - 1)) : 0;
    this.visited.clear(); this.passed = false; this.quizAnswers = new Map();
    this.modal = document.getElementById('tutorialModal'); this.modal.hidden = false;
    this.previousFocus = document.activeElement;
    this.state.setSimplePage('app');
    document.getElementById('tutorialNextBtn').onclick = () => this.handleNext();
    document.getElementById('tutorialPrevBtn').onclick = () => { if (this.currentPage) { this.currentPage--; this.render(); } };
    document.getElementById('tutorialLocateBtn').onclick = () => this.locate();
    document.getElementById('tutorialUnderstood').onchange = event => {
      if (event.target.checked) this.visited.add(this.currentPage); else this.visited.delete(this.currentPage);
      this.position(); this.updateNext();
    };
    this.clickListener = event => {
      const step = this.steps()[this.currentPage];
      if (step.click && event.target.closest(step.selector)) { this.visited.add(this.currentPage); this.updateNext(); }
    };
    this.keyListener = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.key === 'Tab') {
        const target = this.target;
        const controls = target ? [target.matches('button,input,[tabindex]') ? target : null, ...target.querySelectorAll('button,input,[tabindex]')] : [];
        const items = [...controls, ...this.modal.querySelectorAll('button,input')].filter(item => item && !item.disabled && item.getClientRects().length);
        const current = items.indexOf(document.activeElement);
        const next = event.shiftKey ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length;
        event.preventDefault(); items[next]?.focus();
      }
    };
    document.addEventListener('click', this.clickListener);
    document.addEventListener('keydown', this.keyListener, true);
    this.reposition = () => {
      if (this.positionFrame) return;
      this.positionFrame = requestAnimationFrame(() => { this.positionFrame = null; this.position(); this.updateNext(); });
    };
    window.addEventListener('resize', this.reposition);
    document.addEventListener('scroll', this.reposition, true);
    this.timer = setInterval(() => { this.updateNext(); this.reposition(); }, 300);
    this.render();
  }
  hideTutorial(remember = true, force = false) {
    if (!force && this.modal && !this.modal.hidden && !this.passed) return;
    if (remember && this.modal && !this.modal.hidden) settingsStorage.setItem('tutorial-step', String(this.currentPage));
    clearInterval(this.timer);
    cancelAnimationFrame(this.positionFrame); this.positionFrame = null;
    window.removeEventListener('resize', this.reposition);
    document.removeEventListener('scroll', this.reposition, true);
    document.removeEventListener('click', this.clickListener);
    document.removeEventListener('keydown', this.keyListener, true);
    this.target?.classList.remove('tutorial-target');
    if (this.modal) this.modal.hidden = true;
    this.previousFocus?.focus?.();
  }
  locate() {
    const step = this.steps()[this.currentPage];
    if (step.view) { this.state.setSimplePage('app'); this.state.switchView(step.view); }
    if (step.view === 'rules') {
      const page = this.currentPage;
      window.app?.rulesUI?.loadRules().then(() => {
        if (this.modal.hidden || this.currentPage !== page) return;
        document.querySelector(this.steps()[page].selector)?.scrollIntoView({ block: 'center', behavior: 'instant' });
        this.position(); this.updateNext();
      }).catch(error => this.logManager.addErrorLog(error.message, '教程'));
    }
    const target = step.selector ? document.querySelector(step.selector) : null;
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    target?.focus({ preventScroll: true });
    this.position();
  }
  position() {
    if (!this.modal || this.modal.hidden) return;
    const step = this.steps()[this.currentPage];
    const card = this.modal.querySelector('.tutorial-tour__card');
    const ring = this.modal.querySelector('.tutorial-tour__spotlight');
    const target = step.selector ? document.querySelector(step.selector) : null;
    if (target !== this.target) { this.target?.classList.remove('tutorial-target'); this.target = target; }
    ring.hidden = true;
    if (step.quiz || step.welcome) { card.style.cssText = ''; this.shade(null); return; }
    target?.classList.add('tutorial-target');
    let rect = target?.getBoundingClientRect();
    if (rect && rect.width && rect.height) {
      rect = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { rect.top = Math.max(rect.top, bounds.top); rect.bottom = Math.min(rect.bottom, bounds.bottom); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { rect.left = Math.max(rect.left, bounds.left); rect.right = Math.min(rect.right, bounds.right); }
      }
      if (rect.right <= rect.left || rect.bottom <= rect.top) rect = null;
    } else rect = null;
    this.shade(rect);
    const w = card.offsetWidth, h = card.offsetHeight, gap = 14, edge = 12;
    const clamp = (v, max) => Math.max(edge, Math.min(v, max - edge));
    const candidates = rect ? [[rect.left, rect.bottom + gap], [rect.left, rect.top - h - gap], [rect.right + gap, rect.top], [rect.left - w - gap, rect.top]] : [];
    candidates.push([innerWidth - w - edge, innerHeight - h - edge], [edge, edge]);
    const locations = candidates.map(([x,y]) => {
      x = clamp(x, innerWidth - w); y = clamp(y, innerHeight - h);
      const overlap = rect ? Math.max(0, Math.min(x + w, rect.right + 6) - Math.max(x, rect.left - 6)) * Math.max(0, Math.min(y + h, rect.bottom + 6) - Math.max(y, rect.top - 6)) : 0;
      return { x, y, overlap };
    });
    locations.sort((a,b) => a.overlap - b.overlap);
    card.style.left = locations[0].x + 'px'; card.style.top = locations[0].y + 'px';
    card.style.right = 'auto'; card.style.bottom = 'auto';
    if (rect) {
      ring.hidden = false;
      Object.assign(ring.style, { left: rect.left - 5 + 'px', top: rect.top - 5 + 'px', width: rect.right - rect.left + 10 + 'px', height: rect.bottom - rect.top + 10 + 'px' });
    }
    document.getElementById('tutorialLocateBtn').textContent = rect ? '重新定位' : '查找按钮';
  }
  shade(rect) {
    const top = document.getElementById('app-custom-titlebar')?.getBoundingClientRect().bottom || 0;
    const hole = rect ? { left: Math.max(0, rect.left - 6), right: Math.min(innerWidth, rect.right + 6), top: Math.max(top, rect.top - 6), bottom: Math.min(innerHeight, rect.bottom + 6) } : { left: 0, right: 0, top: innerHeight, bottom: innerHeight };
    const areas = [[0,top,innerWidth,hole.top-top], [0,hole.top,hole.left,hole.bottom-hole.top], [hole.right,hole.top,innerWidth-hole.right,hole.bottom-hole.top], [0,hole.bottom,innerWidth,innerHeight-hole.bottom]];
    this.modal.querySelectorAll('.tutorial-tour__shade').forEach((part,index) => {
      const [left,y,width,height] = areas[index];
      Object.assign(part.style,{left:left+'px',top:y+'px',width:Math.max(0,width)+'px',height:Math.max(0,height)+'px'});
    });
  }
  render() {
    const step = this.steps()[this.currentPage];
    this.modal.classList.toggle('tutorial-tour--quiz', !!step.quiz);
    this.modal.classList.toggle('tutorial-tour--welcome', !!step.welcome);
    document.getElementById('tutorialGreeting').hidden = !step.welcome;
    this.modal.querySelector('[role=dialog]').setAttribute('aria-modal', String(!!(step.quiz || step.welcome)));
    settingsStorage.setItem('tutorial-progress-version', '5');
    settingsStorage.setItem('tutorial-step', String(this.currentPage));
    document.getElementById('tutorialStepCount').textContent = `${this.currentPage + 1} / ${this.steps().length}`;
    document.getElementById('tutorialTitle').textContent = step.title;
    document.getElementById('tutorialDescription').textContent = step.text;
    document.getElementById('tutorialFeedback').textContent = '';
    document.getElementById('tutorialPrevBtn').disabled = this.currentPage === 0;
    document.getElementById('tutorialLocateBtn').hidden = !step.selector;
    document.getElementById('tutorialAcknowledge').hidden = !step.acknowledge;
    document.querySelector('#tutorialAcknowledge span').textContent = '我已了解';
    document.getElementById('tutorialUnderstood').checked = this.visited.has(this.currentPage);
    const quiz = document.getElementById('tutorialQuiz'); quiz.replaceChildren();
    quiz.onchange = event => { this.quizAnswers.set(event.target.name, event.target.value); this.passed = false; document.getElementById('tutorialFeedback').textContent = '答案已修改，请重新检查。'; this.updateNext(); };
    if (step.quiz) {
      this.passed = false;
      QUESTIONS.forEach((question, index) => {
        const field = document.createElement('fieldset'), legend = document.createElement('legend');
        legend.textContent = `${index + 1}. ${question.title}`; field.append(legend);
        question.options.forEach((option, choice) => {
          const label = document.createElement('label'), input = document.createElement('input');
          input.type = 'radio'; input.name = 'tutorial-question-' + index; input.value = String(choice);
          input.checked = this.quizAnswers.get(input.name) === input.value;
          label.append(input, document.createTextNode(option)); field.append(label);
        });
        const feedback = document.createElement('p'); feedback.dataset.question = index; field.append(feedback); quiz.append(field);
      });
    }
    this.locate(); this.updateNext();
    if (step.quiz || step.welcome) document.getElementById('tutorialNextBtn').focus();
  }
  updateNext() {
    if (!this.modal || this.modal.hidden) return;
    const step = this.steps()[this.currentPage];
    const ready = step.click || step.acknowledge ? this.visited.has(this.currentPage) && !!this.target?.getClientRects().length : true;
    const button = document.getElementById('tutorialNextBtn');
    button.disabled = !ready;
    button.textContent = step.quiz ? this.passed ? '完成教程' : '检查答案' : step.welcome ? '开始学习' : ready ? '下一步' : step.click ? '请点击高亮入口' : '请确认已理解';
  }
  handleNext() {
    if (document.getElementById('tutorialNextBtn').disabled) return;
    if (this.steps()[this.currentPage].quiz) {
      if (!this.passed) {
        let score = 0;
        QUESTIONS.forEach((question, index) => {
          const checked = document.querySelector(`input[name="tutorial-question-${index}"]:checked`);
          const correct = checked && Number(checked.value) === question.correct;
          if (correct) score++;
          document.querySelector(`[data-question="${index}"]`).textContent = (correct ? '正确。' : '请再想一想。') + question.explanation;
        });
        this.passed = score === QUESTIONS.length;
        document.getElementById('tutorialFeedback').textContent = this.passed ? '全部答对！教程完成不代表代理和增强模式已经开启，使用前仍需确认实际状态。' : `答对 ${score} / ${QUESTIONS.length}，修改后再检查。`;
        this.updateNext(); return;
      }
      settingsStorage.setItem('tutorial-completed', 'true');
      settingsStorage.setItem('tutorial-version', '5');
      settingsStorage.removeItem('tutorial-step'); settingsStorage.removeItem('tutorial-progress-version'); this.hideTutorial(false); return;
    }
    this.currentPage++; this.render();
  }
}
