'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RULESET = path.join(__dirname, '..', 'rulesets', 'auto-listening', 'auto-listening.js');

function extractObjectLiteral(source, marker) {
    const markerAt = source.indexOf(marker);
    if (markerAt < 0) throw new Error('找不到 ' + marker);
    const start = source.indexOf('{', markerAt + marker.length);
    let depth = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (lineComment) {
            if (ch === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') { blockComment = false; i++; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) quote = '';
            continue;
        }
        if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(marker + ' 对象没有闭合');
}

function wait(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createHarness(options = {}) {
    let pageText = 'Read the first answer aloud.';
    let activePhase = '请等待';
    let audioFetches = 0;
    const playback = [];
    const logs = [];
    const choiceSubs = [];

    class FakeTrack {
        stop() {}
    }

    const track = new FakeTrack();

    class FakeMediaRecorder {
        constructor(stream) { this.stream = stream; this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; }
        pause() { this.state = 'paused'; }
        resume() { this.state = 'recording'; }
    }

    class FakeAudioContext {
        constructor() { this.state = 'running'; }
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
        createGain() { return { gain: { value: 1 }, connect() {} }; }
        createMediaStreamDestination() {
            return { stream: { getAudioTracks: () => [track] } };
        }
        decodeAudioData(data) { return Promise.resolve({ duration: 1, id: data.id }); }
        createBufferSource() {
            return {
                buffer: null,
                loop: false,
                connect() {},
                disconnect() {},
                stop() {},
                start() { playback.push(this.buffer.id); },
            };
        }
    }

    const host = {
        get innerText() { return pageText; },
        get textContent() { return pageText; },
        getBoundingClientRect() { return { left: 100, right: 700, top: 100, bottom: 180, width: 600, height: 80 }; },
    };
    const slide = {
        querySelector: selector => selector === '.speak' ? host : null,
        querySelectorAll: selector => selector === '.speak' ? [host] : [],
        getBoundingClientRect() { return { left: 0, right: 900, top: 0, bottom: 700, width: 900, height: 700 }; },
    };
    const hiddenBar = {
        innerText: '请等待', textContent: '请等待',
        getBoundingClientRect() { return { left: 5000, right: 5300, top: 800, bottom: 840, width: 300, height: 40 }; },
    };
    const activeBar = {
        get innerText() { return activePhase; },
        get textContent() { return activePhase; },
        getBoundingClientRect() { return { left: 100, right: 400, top: 700, bottom: 740, width: 300, height: 40 }; },
    };
    const document = {
        querySelector(selector) {
            if (selector === '.slide') return slide;
            if (selector === '.bar' && options.multiBars) return hiddenBar;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.choice') return choiceSubs;
            if (selector === '.bar' && options.multiBars) return [hiddenBar, activeBar];
            if (selector === '.slide') return [slide];
            return [];
        },
        getElementById() { return null; },
    };
    const navigator = { mediaDevices: { getUserMedia: async () => ({ real: true }) } };
    const responseIndex = url => Number((url.match(/\/(\d+)\.wav$/) || [])[1]);

    const timer = options.fastTimers
        ? (fn, ms, ...args) => setTimeout(fn, Math.min(ms || 0, 1), ...args)
        : setTimeout;
    const sandbox = {
        assert,
        console,
        document,
        navigator,
        MediaStreamTrack: FakeTrack,
        MediaRecorder: FakeMediaRecorder,
        MutationObserver: class { observe() {} disconnect() {} },
        setTimeout: timer,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        Set,
        Map,
        BUCKET_URL: 'http://127.0.0.1:5290',
        SPK: {
            subChoice: '.choice', qText: '.q', opt: '.opt', optCont: '.optText',
            optRadio: '.radio', selected: 'selected', speakHost: '.speak',
            slide: '.slide', barTitle: '.bar',
        },
        spkText: el => ((el && (el.innerText || el.textContent)) || '').trim().replace(/\s+/g, ' '),
        // swiper 隐藏页的 getBoundingClientRect 为 0；选择题仍应被一次性填写。
        spkVisible: () => false,
        spkOnScreen(el) {
            if (!el || !el.getBoundingClientRect) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < 1000 && r.top < 800;
        },
        spkClick(el) { if (el && typeof el.click === 'function') el.click(); },
        addLog(message, type) { logs.push({ message, type }); },
        fetch: async url => {
            if (/\/output\//.test(url)) {
                audioFetches++;
                if (audioFetches <= (options.audioFailuresBeforeReady || 0)) {
                    return { ok: false, status: 404 };
                }
            }
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => {
                    if (options.audioDelay) await wait(options.audioDelay);
                    return { id: responseIndex(url) };
                },
                json: async () => options.manifestResponse || ({ ready: true, count: 2, items: [] }),
            };
        },
    };
    sandbox.window = {
        AudioContext: FakeAudioContext,
        MediaRecorder: FakeMediaRecorder,
        MediaStreamTrack: FakeTrack,
        navigator,
        document,
        innerWidth: 1000,
        innerHeight: 800,
    };

    const source = fs.readFileSync(RULESET, 'utf8');
    const literal = extractObjectLiteral(source, 'const Speaking =');
    const context = vm.createContext(sandbox);
    const speaking = vm.runInContext('(' + literal + ')', context);
    if (!options.emptyManifest) {
        speaking.manifest = [
            { index: 0, text: 'Read the first answer aloud.', meta: {} },
            { index: 1, text: 'Read the second answer aloud.', meta: {} },
        ];
    }

    return {
        speaking,
        navigator,
        FakeMediaRecorder,
        track,
        playback,
        logs,
        setPageText(text) { pageText = text; },
        setActivePhase(text) { activePhase = text; },
        installHiddenChoices(count) {
            speaking.choices = [];
            for (let i = 0; i < count; i++) {
                const question = 'Hidden question ' + (i + 1) + '?';
                const wanted = 'Correct answer ' + (i + 1);
                let selected = false;
                const options = ['Wrong A ' + i, wanted, 'Wrong C ' + i].map(body => {
                    const textNode = { innerText: body, textContent: body };
                    const radio = { click() { selected = true; } };
                    return {
                        innerText: body,
                        textContent: body,
                        querySelector(selector) {
                            if (selector === '.optText') return textNode;
                            if (selector === '.radio') return radio;
                            return null;
                        },
                    };
                });
                const qNode = { innerText: question, textContent: question };
                choiceSubs.push({
                    querySelector(selector) {
                        if (selector === '.q') return qNode;
                        if (selector === '.opt') return options[0];
                        if (selector === '.selected') return selected ? {} : null;
                        return null;
                    },
                    querySelectorAll(selector) { return selector === '.opt' ? options : []; },
                    get selected() { return selected; },
                });
                speaking.choices.push({ question, answer: 'B. ' + wanted });
            }
        },
        choiceSubs,
    };
}

async function main() {
    const h = createHarness();
    h.speaking.running = true;
    await h.speaking.arm();
    if (typeof h.speaking.preloadAudio === 'function') await h.speaking.preloadAudio();

    // 真页面通常只申请一次麦克风，然后每一道口语题重复 start/stop 同一录音器。
    const stream = await h.navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new h.FakeMediaRecorder(stream);

    recorder.start();
    await wait(10);
    recorder.stop();
    h.setPageText('Read the second answer aloud.');
    recorder.start();
    await wait(10);
    recorder.stop();

    assert.deepStrictEqual(
        h.playback,
        [0, 1],
        '同一麦克风流连续录两题时，必须依次灌入两条音频；实际 ' + JSON.stringify(h.playback),
    );
    console.log('PASS speaking lifecycle: one getUserMedia, two recorder sessions -> two audios');
    h.speaking.stopAuto();

    const choices = createHarness();
    choices.installHiddenChoices(6);
    assert.strictEqual(choices.speaking.fillChoices(false), 6, '必须一次填写 swiper 中全部 6 道隐藏选择题');
    assert.ok(choices.choiceSubs.every(sub => sub.selected), '6 道隐藏选择题都应进入选中态');
    console.log('PASS speaking choices: all six hidden swiper questions are filled');

    const race = createHarness({ audioDelay: 30 });
    race.speaking.running = true;
    await race.speaking.arm();
    const raceStream = await race.navigator.mediaDevices.getUserMedia({ audio: true });
    const raceRecorder = new race.FakeMediaRecorder(raceStream);
    raceRecorder.start();
    await wait(2);
    raceRecorder.stop();
    await wait(50);
    assert.deepStrictEqual(race.playback, [], '录音窗口已结束后不能把旧音频播到下一题');
    assert.strictEqual(race.speaking.used.size, 0, '没有真正播放的音频不能提前标记为已用');
    console.log('PASS speaking race: page advance cancels pending audio without consuming it');
    race.speaking.stopAuto();

    const phases = createHarness({ multiBars: true });
    phases.speaking.running = true;
    await phases.speaking.arm();
    await phases.speaking.preloadAudio();
    phases.setActivePhase('请答题');
    await wait(500);
    phases.setActivePhase('请稍等');
    await wait(150);
    phases.setPageText('Read the second answer aloud.');
    phases.setActivePhase('请答题');
    await wait(500);
    assert.deepStrictEqual(phases.playback, [0, 1], '必须监听屏幕内的活动考试栏，而不是 DOM 中第一个隐藏栏');
    console.log('PASS speaking phases: active exam bar drives every spoken answer');
    phases.speaking.stopAuto();

    const trackReset = createHarness();
    trackReset.speaking.running = true;
    await trackReset.speaking.arm();
    await trackReset.speaking.preloadAudio();
    const resetStream = await trackReset.navigator.mediaDevices.getUserMedia({ audio: true });
    const resetRecorder = new trackReset.FakeMediaRecorder(resetStream);
    resetRecorder.start();
    await wait(20);
    trackReset.track.stop();
    await wait(10);
    const survivedTrackStop = !!trackReset.speaking.source;
    resetRecorder.stop();
    trackReset.speaking.stopAuto();
    assert.ok(survivedTrackStop, '组件调用 track.stop 只能被拦截，不能顺便掐断正在灌入的音频');
    console.log('PASS speaking track protection: component track.stop does not cut audio');

    const early = createHarness();
    early.speaking.setAnswers = () => {};
    early.speaking.createUI = () => {};
    early.speaking.waitAnswers = async () => false;
    early.speaking.init([], 'test');
    await wait(20);
    const cachedStream = await early.navigator.mediaDevices.getUserMedia({ audio: true });
    assert.strictEqual(cachedStream, early.speaking.stream, '听说界面初始化时必须先接管麦克风，不能等用户点击按钮');
    console.log('PASS speaking early hook: page caches the fake stream before auto-answer starts');
    early.speaking.stopAuto();

    const lateAudio = createHarness({ fastTimers: true, audioFailuresBeforeReady: 3 });
    lateAudio.speaking.running = true;
    await lateAudio.speaking.arm();
    const lateStream = await lateAudio.navigator.mediaDevices.getUserMedia({ audio: true });
    const lateRecorder = new lateAudio.FakeMediaRecorder(lateStream);
    lateRecorder.start();
    await wait(80);
    const latePlayback = lateAudio.playback.slice();
    lateRecorder.stop();
    lateAudio.speaking.stopAuto();
    assert.deepStrictEqual(latePlayback, [0],
        '录音窗口开始后 wav 才生成完成时，必须在窗口内重试并补灌，不能第一次 404 就放弃');
    console.log('PASS speaking late audio: retries until current wav appears');

    // 真机视频中的精确故障：TTS 已经开始生成，清单和前几条 wav 已存在，
    // 但全批次尚未结束（ready=false）。不能因此把整份清单拒绝 60 秒，
    // 否则“请答题”窗口会在等待期间直接过去。
    const partialItems = [
        { index: 0, text: 'Read the first answer aloud.', meta: {} },
        { index: 1, text: 'Read the second answer aloud.', meta: {} },
    ];
    const partial = createHarness({
        emptyManifest: true,
        fastTimers: true,
        manifestResponse: {
            ready: false,
            generating: true,
            count: partialItems.length,
            generatedCount: 1,
            readyIndexes: [0],
            items: partialItems,
        },
    });
    partial.speaking.running = true;
    const acceptedPartial = await partial.speaking.loadManifest();
    assert.strictEqual(acceptedPartial, true,
        'TTS 仍在生成时也必须立刻接收清单，不能等全部音频完成后才开始灌音');
    assert.strictEqual(partial.speaking.manifest.length, 2, '部分就绪时必须保留完整题目映射');
    console.log('PASS speaking partial TTS: manifest is usable before the whole batch finishes');

    const approvalPending = createHarness({
        emptyManifest: true,
        fastTimers: true,
        manifestResponse: {
            ready: false,
            generating: false,
            count: 1,
            generatedCount: 0,
            readyIndexes: [],
            approvalPending: true,
            items: [{ index: 1, text: 'Read the first answer aloud.', meta: {} }],
        },
    });
    approvalPending.speaking.running = true;
    const approvalReady = await approvalPending.speaking.preloadAudio();
    assert.strictEqual(approvalReady, false, '等待审批时不能假装朗读音频已经就绪');
    assert.ok(approvalPending.logs.some(log => /尚未生成|等待审批/.test(log.message)),
        '控制台必须明确提醒用户确认生成 TTS');
    console.log('PASS speaking approval reminder: console explains that TTS has not been generated');
}

main().catch(error => {
    console.error('FAIL speaking lifecycle:', error.message);
    process.exitCode = 1;
});
