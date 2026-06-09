(function() {
'use strict';

const POS_LIST = ['interj', 'prep', 'pron', 'abbr', 'conj', 'adj', 'adv', 'num', 'art', 'vt', 'vi', 'n', 'v'];
const POS_ALT = POS_LIST.join('|');
const POS_ABBREV_PATTERN = new RegExp('^(?:(?:' + POS_ALT + ')(?=\\.|\\s|[\\u4e00-\\u9fff]|$)\\.?\\s*(?:&\\s*(?:' + POS_ALT + ')\\.?\\s*)*)\\s*');

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'of', 'to', 'for', 'with', 'by', 'from',
    'about', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'over', 'up', 'down', 'off', 'out', 'upon',
    'within', 'without', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both',
    'either', 'neither', 'be', 'am', 'is', 'are', 'was', 'were', 'been',
    'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
    'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
    'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
    'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that',
    'these', 'those', 'not', 'no', 'if', 'then', 'also', 'just', 'very',
    'every', 'some', 'any', 'each', 'all', 'few', 'more', 'most',
    'other', 'such', 'only', 'own', 'same', 'so', 'than', 'too'
]);

const BUCKET_MAX_RETRIES = 10;
const LOG_ROW_HEIGHT = 22;
const AI_TIMEOUT = 3000;
const AI_API_URL = 'https://api.deepseek.com/chat/completions';
const AI_MODEL = 'deepseek-v4-flash';

var Utils = {
    parseParaphrase: function(paraphrase) {
        if (!paraphrase) return { pos: [], meanings: [], meaning_text: '' };
        var allPos = [];
        var allMeanings = [];
        var lines = paraphrase.split(/\n/).filter(function(l) { return l.trim(); });
        var meaningText = '';
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var posMatch = line.match(POS_ABBREV_PATTERN);
            var posStr = '';
            var meaningPart = line;
            if (posMatch) {
                posStr = posMatch[0].trim();
                meaningPart = line.substring(posMatch[0].length);
            }
            if (posStr) {
                var tags = posStr.split(/\s*&\s*/).map(function(p) { return p.trim(); }).filter(function(p) { return p; });
                allPos.push.apply(allPos, tags);
            }
            var parts = meaningPart.split(/[；;]/).map(function(m) { return m.trim(); }).filter(function(m) { return m; });
            allMeanings.push.apply(allMeanings, parts);
            if (i === 0) {
                if (posStr && parts.length > 0) {
                    meaningText = posStr + ' ' + parts[0];
                } else if (parts.length > 0) {
                    meaningText = parts[0];
                } else if (posStr) {
                    meaningText = posStr;
                }
            }
        }
        return { pos: allPos, meanings: allMeanings, meaning_text: meaningText };
    },

    normalizePunctuation: function(text) {
        if (!text) return '';
        return text
            .replace(/\.{2,}/g, '…')
            .replace(/。{2,}/g, '…')
            .replace(/…{2,}/g, '…');
    },

    normalizeText: function(text) {
        if (!text) return '';
        return Utils.normalizePunctuation(
            text.trim().toLowerCase()
        ).replace(/[………]/g, '');
    },

    normalizeEntryKey: function(text) {
        if (!text) return '';
        return Utils.normalizePunctuation(
            text.trim().toLowerCase()
        ).replace(/[\s………\-]/g, '');
    },

    calculateSimilarity: function(str1, str2) {
        var s1 = Utils.normalizeText(str1);
        var s2 = Utils.normalizeText(str2);

        if (s1 === s2) return 100;

        if (s1.includes(s2) || s2.includes(s1)) {
            var minLen = Math.min(s1.length, s2.length);
            var maxLen = Math.max(s1.length, s2.length);
            return (minLen / maxLen) * 90;
        }

        var words1 = s1.split(/[\s，；,;、]/).filter(function(w) { return w.length > 0; });
        var words2 = s2.split(/[\s，；,;、]/).filter(function(w) { return w.length > 0; });

        if (words1.length === 0 || words2.length === 0) {
            var commonChars = 0;
            var charSet2 = new Set(s2);
            var _arr2 = s1;
            for (var _i2 = 0; _i2 < _arr2.length; _i2++) {
                var ch = _arr2[_i2];
                if (charSet2.has(ch)) commonChars++;
            }
            return (commonChars / Math.max(s1.length, s2.length)) * 70;
        }

        var matchedWords = 0;
        for (var _i3 = 0; _i3 < words1.length; _i3++) {
            var w1 = words1[_i3];
            for (var _j = 0; _j < words2.length; _j++) {
                var w2 = words2[_j];
                if (w1 === w2) {
                    matchedWords++;
                    break;
                } else if (w1.includes(w2) || w2.includes(w1)) {
                    matchedWords += 0.7;
                    break;
                }
            }
        }

        var wordScore = (matchedWords / Math.max(words1.length, words2.length)) * 80;

        var commonChars2 = 0;
        var charSet22 = new Set(s2);
        var _arr3 = s1;
        for (var _i4 = 0; _i4 < _arr3.length; _i4++) {
            var ch2 = _arr3[_i4];
            if (charSet22.has(ch2)) commonChars2++;
        }
        var charScore = (commonChars2 / Math.max(s1.length, s2.length)) * 20;

        return wordScore + charScore;
    },

    decodeHtmlEntities: function(text) {
        var textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    },

    removePartOfSpeech: function(text) {
        if (!text) return '';
        text = Utils.decodeHtmlEntities(text);
        var result = text.replace(POS_ABBREV_PATTERN, '').trim();
        if (!result) {
            var dotIndex = text.indexOf('.');
            if (dotIndex !== -1 && dotIndex < text.length - 1) {
                result = text.substring(dotIndex + 1).trim();
            } else {
                result = text.trim();
            }
        }
        result = result.replace(/[\(（][^\)）]*[\)）]/g, '').replace(/\s+/g, ' ').trim();
        return result;
    },

    extractPosSet: function(text) {
        if (!text) return new Set(['other']);
        text = Utils.decodeHtmlEntities(text);
        var posMatch = text.match(POS_ABBREV_PATTERN);
        if (!posMatch || !posMatch[0].trim()) return new Set(['other']);
        var posStr = posMatch[0].trim();
        var tags = posStr.split(/\s*&\s*/).map(function(p) { return p.replace(/\./g, '').trim().toLowerCase(); }).filter(function(p) { return p; });
        if (tags.length === 0) return new Set(['other']);
        var normalized = new Set();
        for (var _i5 = 0; _i5 < tags.length; _i5++) {
            var tag = tags[_i5];
            if (tag === 'vt' || tag === 'vi') normalized.add('v');
            else normalized.add(tag);
        }
        return normalized;
    },

    isPosCompatible: function(set1, set2) {
        if (set1.has('other') || set2.has('other')) return true;
        var _arr4 = Array.from(set1);
        for (var _i6 = 0; _i6 < _arr4.length; _i6++) {
            var p = _arr4[_i6];
            if (set2.has(p)) return true;
        }
        return false;
    },

    chineseCharOverlap: function(s1, s2) {
        var chars1 = new Set((s1.match(/[\u4e00-\u9fff]/g) || []));
        var chars2 = new Set((s2.match(/[\u4e00-\u9fff]/g) || []));
        if (chars1.size === 0 || chars2.size === 0) return 0;
        var overlap = 0;
        var _arr5 = Array.from(chars1);
        for (var _i7 = 0; _i7 < _arr5.length; _i7++) {
            var ch = _arr5[_i7];
            if (chars2.has(ch)) overlap++;
        }
        return overlap / Math.max(chars1.size, chars2.size);
    },

    chineseCharCoverage: function(shorter, longer) {
        var charsShort = new Set((shorter.match(/[\u4e00-\u9fff]/g) || []));
        var charsLong = new Set((longer.match(/[\u4e00-\u9fff]/g) || []));
        if (charsShort.size === 0 || charsLong.size === 0) return 0;
        var matched = 0;
        var _arr6 = Array.from(charsShort);
        for (var _i8 = 0; _i8 < _arr6.length; _i8++) {
            var ch = _arr6[_i8];
            if (charsLong.has(ch)) matched++;
        }
        return matched / charsShort.size;
    },

    calculatePhraseMeaningMatchScore: function(questionText, phraseWord, questionIsChinese, phraseInfo) {
        var qText = Utils.normalizeText(Utils.removePartOfSpeech(questionText));
        var highScore = 0;

        if (questionIsChinese) {
            var meaningsToCheck = (phraseInfo.clean_meanings || []).concat(phraseInfo.meanings);
            for (var _i9 = 0; _i9 < meaningsToCheck.length; _i9++) {
                var meaning = meaningsToCheck[_i9];
                var nm = Utils.normalizeText(meaning);
                if (nm === qText) {
                    highScore = 100;
                    break;
                }
                if (nm.includes(qText) || qText.includes(nm)) {
                    var minLen = Math.min(nm.length, qText.length);
                    var maxLen = Math.max(nm.length, qText.length);
                    var subScore = (minLen / maxLen) * 90;
                    if (subScore > highScore) highScore = subScore;
                }
                var overlap = Utils.chineseCharOverlap(qText, nm);
                if (overlap >= 0.5) {
                    var overlapScore = overlap * 80;
                    if (overlapScore > highScore) highScore = overlapScore;
                }
            }
        } else {
            var qClean = Utils.normalizeText(Utils.removePartOfSpeech(questionText));
            var entryQ = Utils.normalizeEntryKey(qClean);
            var phraseNorm = Utils.normalizeText(phraseWord);
            var phraseKey = Utils.normalizeEntryKey(phraseWord);

            if (phraseNorm === qClean || phraseKey === entryQ) {
                highScore = 100;
            } else if (phraseNorm.includes(qClean) || qClean.includes(phraseNorm)) {
                var minLen2 = Math.min(phraseNorm.length, qClean.length);
                var maxLen2 = Math.max(phraseNorm.length, qClean.length);
                highScore = Math.max(highScore, (minLen2 / maxLen2) * 90);
            } else {
                for (var _i10 = 0; _i10 < phraseInfo.meanings.length; _i10++) {
                    var meaning2 = phraseInfo.meanings[_i10];
                    var nm2 = Utils.normalizeText(meaning2);
                    if (nm2.includes(qClean) || qClean.includes(nm2)) {
                        var minLen3 = Math.min(nm2.length, qClean.length);
                        var maxLen3 = Math.max(nm2.length, qClean.length);
                        highScore = Math.max(highScore, (minLen3 / maxLen3) * 80);
                    }
                }
            }
        }
        return Math.min(highScore, 100);
    }
};

var State = {
    jsonData: null,
    bucketLoaded: false,
    bucketError: null,
    bucketRetryCount: 0,
    customBucketUrl: localStorage.getItem('customBucketUrl') || '',
    autoPkDelay: 1000,
    autoPkIntervalId: null,
    lastMatchedWord: '',
    matchCount: 0,
    missCount: 0,
    currentBucketType: null,
    scoreControlEnabled: localStorage.getItem('scoreControlEnabled') === 'true',
    scoreControlMode: localStorage.getItem('scoreControlMode') || 'rate',
    targetScoreRate: parseInt(localStorage.getItem('targetScoreRate'), 10) || 100,
    targetCorrectCount: parseInt(localStorage.getItem('targetCorrectCount'), 10) || 0,
    totalWordsInBucket: 0,
    answeredCorrectly: 0,
    answeredTotal: 0,
    scoreControlActive: false,
    lastMatchScores: [],
    aiApiKey: '',
    aiEnabled: localStorage.getItem('aiEnabled') === 'true',
    aiThreshold: parseInt(localStorage.getItem('aiThreshold'), 10) || 50,
    aiWaiting: false,
    // ===== 时间修改修改（隶属"通用自动PK"，可关可开的子规则）=====
    pkTimeModEnabled: localStorage.getItem('pkTimeModEnabled') === 'true',
    // 秒数：未设置时为 null，面板显示 "-"；int32 全范围
    pkTimeModSeconds: (function() {
        var raw = localStorage.getItem('pkTimeModSeconds');
        if (raw === null || raw === '') return null;
        var v = parseInt(raw, 10);
        return Number.isFinite(v) ? v : null;
    })()
};

var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;

var MatcherFull = {
    standardizeEntry: function(rawEntry) {
        var entry = rawEntry.entry || '';
        var entryId = rawEntry.entryId || null;

        var allParaphraseTexts = [];
        if (rawEntry.paraphrase) {
            allParaphraseTexts.push(rawEntry.paraphrase);
        }

        if (rawEntry.newPropList && Array.isArray(rawEntry.newPropList)) {
            for (var _i11 = 0; _i11 < rawEntry.newPropList.length; _i11++) {
                var prop = rawEntry.newPropList[_i11];
                if (prop.senseList && Array.isArray(prop.senseList)) {
                    for (var _j2 = 0; _j2 < prop.senseList.length; _j2++) {
                        var sense = prop.senseList[_j2];
                        if (sense.paraphrase && typeof sense.paraphrase === 'string') {
                            allParaphraseTexts.push(sense.paraphrase);
                        }
                    }
                }
            }
        }

        var allPos = [];
        var allMeanings = [];
        var meaning_text = '';
        var matchKeys = new Set();

        for (var _i12 = 0; _i12 < allParaphraseTexts.length; _i12++) {
            var text = allParaphraseTexts[_i12];
            var parsed = Utils.parseParaphrase(text);
            var pos = parsed.pos;
            var meanings = parsed.meanings;
            var mt = parsed.meaning_text;
            allPos.push.apply(allPos, pos);
            allMeanings.push.apply(allMeanings, meanings);
            if (!meaning_text && mt) meaning_text = mt;
        }

        var uniquePos = Array.from(new Set(allPos));
        var uniqueMeanings = Array.from(new Set(allMeanings));

        matchKeys.add(entry);
        for (var _i13 = 0; _i13 < uniqueMeanings.length; _i13++) {
            var meaning = uniqueMeanings[_i13];
            matchKeys.add(meaning);
            var fineParts = meaning.split(/[，,、]/).map(function(p) { return p.trim(); }).filter(function(p) { return p && p.length >= 1; });
            for (var _j3 = 0; _j3 < fineParts.length; _j3++) {
                var part = fineParts[_j3];
                matchKeys.add(part);
            }
        }
        if (meaning_text) {
            matchKeys.add(meaning_text);
            var fineParts2 = meaning_text.split(/[，,、]/).map(function(p) { return p.trim(); }).filter(function(p) { return p && p.length >= 1; });
            for (var _j4 = 0; _j4 < fineParts2.length; _j4++) {
                var part2 = fineParts2[_j4];
                matchKeys.add(part2);
            }
        }

        var variants = [];
        if (entry.includes('/')) {
            variants = entry.split('/').map(function(v) { return v.trim(); }).filter(function(v) { return v; });
            for (var _i14 = 0; _i14 < variants.length; _i14++) {
                var v = variants[_i14];
                matchKeys.add(v);
            }
        }

        var isPhrase = entry.includes(' ');
        var cleanMeanings = uniqueMeanings.map(function(m) { return m.replace(/[\(（][^\)）]*[\)）]/g, '').trim(); }).filter(function(m) { return m; });

        UI.addLogMessage('[标准化] 词条="' + entry + '" | 释义数=' + allParaphraseTexts.length + ' | 词性=' + JSON.stringify(uniquePos) + ' | 释义=' + JSON.stringify(uniqueMeanings.slice(0, 5)) + ' | matchKeys数=' + matchKeys.size + ' | 变体=' + JSON.stringify(variants) + ' | 短语=' + isPhrase + ' | 纯净释义=' + JSON.stringify(cleanMeanings.slice(0, 3)), 'info');

        return {
            word: entry,
            pos: uniquePos,
            meanings: uniqueMeanings,
            meaning_text: meaning_text,
            match_keys: Array.from(matchKeys),
            variants: variants,
            entryId: entryId,
            is_phrase: isPhrase,
            clean_meanings: cleanMeanings
        };
    },

    build: function(entryList) {
        var words = [];
        var byQuestion = {};
        var byWord = {};
        var seen = new Set();
        var duplicateCount = 0;
        for (var _i15 = 0; _i15 < entryList.length; _i15++) {
            var rawEntry = entryList[_i15];
            var std = MatcherFull.standardizeEntry(rawEntry);
            var dedupeKey = std.word + '_' + std.meaning_text;
            if (seen.has(dedupeKey)) {
                duplicateCount++;
                continue;
            }
            seen.add(dedupeKey);
            words.push(std);
            for (var _i16 = 0; _i16 < std.match_keys.length; _i16++) {
                var key = std.match_keys[_i16];
                if (key) {
                    if (!byQuestion[key]) byQuestion[key] = [];
                    if (byQuestion[key].length < 3 && byQuestion[key].indexOf(std.word) === -1) byQuestion[key].push(std.word);
                }
                var nk = Utils.normalizeText(key);
                if (nk) {
                    if (!byQuestion[nk]) byQuestion[nk] = [];
                    if (byQuestion[nk].length < 3 && byQuestion[nk].indexOf(std.word) === -1) byQuestion[nk].push(std.word);
                }
                var ek = Utils.normalizeEntryKey(key);
                if (ek && ek !== nk) {
                    if (!byQuestion[ek]) byQuestion[ek] = [];
                    if (byQuestion[ek].length < 3 && byQuestion[ek].indexOf(std.word) === -1) byQuestion[ek].push(std.word);
                }
            }
            for (var _i17 = 0; _i17 < std.variants.length; _i17++) {
                var variant = std.variants[_i17];
                if (variant) {
                    if (!byQuestion[variant]) byQuestion[variant] = [];
                    if (byQuestion[variant].length < 3 && byQuestion[variant].indexOf(std.word) === -1) byQuestion[variant].push(std.word);
                }
                var nv = Utils.normalizeText(variant);
                if (nv) {
                    if (!byQuestion[nv]) byQuestion[nv] = [];
                    if (byQuestion[nv].length < 3 && byQuestion[nv].indexOf(std.word) === -1) byQuestion[nv].push(std.word);
                }
                var ev = Utils.normalizeEntryKey(variant);
                if (ev) {
                    if (!byQuestion[ev]) byQuestion[ev] = [];
                    if (byQuestion[ev].length < 3 && byQuestion[ev].indexOf(std.word) === -1) byQuestion[ev].push(std.word);
                }
            }
            if (!byWord[std.word]) {
                byWord[std.word] = {
                    pos: std.pos,
                    meanings: std.meanings,
                    clean_meanings: std.clean_meanings,
                    is_phrase: std.is_phrase
                };
            }
        }

        var phraseIndex = {};
        for (var _i18 = 0; _i18 < words.length; _i18++) {
            var _std = words[_i18];
            if (_std.is_phrase) {
                var phraseWords = _std.word.toLowerCase().split(/\s+/).filter(function(w) { return !STOP_WORDS.has(w); });
                for (var _i19 = 0; _i19 < phraseWords.length; _i19++) {
                    var pw = phraseWords[_i19];
                    if (!phraseIndex[pw]) phraseIndex[pw] = [];
                    if (!phraseIndex[pw].includes(_std.word)) {
                        phraseIndex[pw].push(_std.word);
                    }
                }
            }
        }

        UI.addLogMessage('词库标准化完成: 原始 ' + entryList.length + ' 条 → 标准化后 ' + words.length + ' 条 (去重 ' + duplicateCount + ' 条)', 'info');
        UI.addLogMessage('[索引] byQuestion键数=' + Object.keys(byQuestion).length + ' | byWord键数=' + Object.keys(byWord).length + ' | phraseIndex键数=' + Object.keys(phraseIndex).length, 'info');
        return {
            version: '3.5',
            index: {
                by_question: byQuestion,
                by_word: byWord,
                phrase_index: phraseIndex
            },
            words: words
        };
    },

    match: function(word, candidates) {
        if (!State.jsonData || !State.jsonData.version || State.jsonData.version !== '3.5') {
            UI.addLogMessage('[匹配] 词库未就绪，跳过匹配', 'warning');
            State.lastMatchScores = [];
            return 0;
        }

        candidates = candidates.map(function(c) { return Utils.decodeHtmlEntities(c); });

        var byQuestion = State.jsonData.index.by_question;
        var byWord = State.jsonData.index.by_word;
        var wordsList = State.jsonData.words;

        var isChineseInput = /[\u4e00-\u9fff]/.test(word);
        var questionPosSet = Utils.extractPosSet(word);
        var cleanedWord = Utils.removePartOfSpeech(word);
        var normalizedWord = Utils.normalizeText(word);
        var normalizedCleaned = Utils.normalizeText(cleanedWord);
        var entryKeyWord = Utils.normalizeEntryKey(word);
        var entryKeyCleaned = Utils.normalizeEntryKey(cleanedWord);

        UI.addLogMessage('[匹配] 原始题目="' + word + '" | 是否中文=' + isChineseInput + ' | 清理后="' + cleanedWord + '" | 归一化="' + normalizedCleaned + '" | entryKey="' + entryKeyCleaned + '"', 'info');
        UI.addLogMessage('[匹配] 题目词性=' + JSON.stringify(Array.from(questionPosSet)) + ' | 候选数=' + candidates.length, 'info');

        var targetWords = new Set();

        var lookupKeys = [word, normalizedWord, cleanedWord, normalizedCleaned, entryKeyWord, entryKeyCleaned];
        for (var _i20 = 0; _i20 < lookupKeys.length; _i20++) {
            var key = lookupKeys[_i20];
            if (key && byQuestion[key]) {
                var hits = byQuestion[key];
                for (var h = 0; h < hits.length; h++) {
                    targetWords.add(hits[h]);
                }
                UI.addLogMessage('[索引命中] key="' + key + '" → word="' + hits.join(',') + '"', 'info');
            }
        }

        if (isChineseInput && targetWords.size === 0) {
            UI.addLogMessage('[索引未命中] 中文输入，遍历词库进行子串匹配...', 'info');
            for (var _i21 = 0; _i21 < wordsList.length; _i21++) {
                var w = wordsList[_i21];
                var checkList = (w.clean_meanings || []).concat(w.meanings).concat(w.match_keys);
                var matched = false;
                for (var _j5 = 0; _j5 < checkList.length; _j5++) {
                    var item = checkList[_j5];
                    var nm = Utils.normalizeText(item);
                    if (nm && normalizedCleaned && (nm.includes(normalizedCleaned) || normalizedCleaned.includes(nm))) {
                        targetWords.add(w.word);
                        matched = true;
                        break;
                    }
                }
                if (matched) {
                    UI.addLogMessage('[子串匹配] 通过 clean_meanings/meanings/match_keys 命中: ' + w.word, 'info');
                }
            }
        }

        if (!isChineseInput && targetWords.size === 0) {
            UI.addLogMessage('[索引未命中] 英文输入，遍历词库进行单词/变体匹配...', 'info');
            for (var _i22 = 0; _i22 < wordsList.length; _i22++) {
                var w2 = wordsList[_i22];
                if (Utils.normalizeText(w2.word) === normalizedCleaned || Utils.normalizeEntryKey(w2.word) === entryKeyCleaned) {
                    targetWords.add(w2.word);
                }
                for (var _i23 = 0; _i23 < w2.variants.length; _i23++) {
                    var variant = w2.variants[_i23];
                    if (Utils.normalizeText(variant) === normalizedCleaned || Utils.normalizeEntryKey(variant) === entryKeyCleaned) {
                        targetWords.add(w2.word);
                    }
                }
            }
        }

        var phraseCandidateCount = candidates.filter(function(c) { return c && c.includes(' '); }).length;
        var isPhraseQuestion = isChineseInput && candidates.length > 0 && phraseCandidateCount / candidates.length >= 0.5;

        if (isPhraseQuestion) {
            UI.addLogMessage('[短语检测] 空格选项占比=' + Math.round(phraseCandidateCount / candidates.length * 100) + '%，判定为短语题', 'info');

            var directPhraseScores = [];
            for (var i = 0; i < candidates.length; i++) {
                var candidate = candidates[i];
                if (!candidate) continue;

                var cleanCand = Utils.removePartOfSpeech(candidate);
                var candKey = Utils.normalizeEntryKey(cleanCand);
                var exactKey = Utils.normalizeText(cleanCand);

                var foundWord = null;
                var phraseHits = byQuestion[exactKey] || byQuestion[candKey] || byQuestion[cleanCand];
                if (phraseHits) {
                    for (var phi = 0; phi < phraseHits.length; phi++) {
                        var pw = phraseHits[phi];
                        var pwi = byWord[pw];
                        if (pwi && pwi.is_phrase) {
                            foundWord = pw;
                            break;
                        }
                    }
                    if (!foundWord && phraseHits.length > 0) foundWord = phraseHits[0];
                }

                var matchedScore = 0;
                if (foundWord) {
                    var foundInfo = byWord[foundWord];
                    if (foundInfo && foundInfo.is_phrase) {
                        matchedScore = Utils.calculatePhraseMeaningMatchScore(word, foundWord, isChineseInput, foundInfo);
                        if (matchedScore > 0) {
                            UI.addLogMessage('[短语直连] 候选[' + i + ']="' + candidate + '" 命中短语 "' + foundWord + '"，得分=' + Math.round(matchedScore) + '%', 'info');
                        }
                    }
                }
                directPhraseScores.push({ index: i, candidate: candidate, score: matchedScore, phraseWord: foundWord });
            }

            directPhraseScores.sort(function(a, b) { return b.score - a.score; });
            var bestDirect = directPhraseScores[0];

            if (bestDirect && bestDirect.score >= 80) {
                UI.addLogMessage('[结果] 短语直连最优: [' + bestDirect.index + '] ' + bestDirect.candidate + '，得分=' + Math.round(bestDirect.score) + '%', 'success');
                State.lastMatchScores = directPhraseScores;
                State.matchCount++;
                return bestDirect.index;
            }

            if (bestDirect && bestDirect.score > 0) {
                UI.addLogMessage('[短语直连] 最高分仅' + Math.round(bestDirect.score) + '%，未达阈值，继续后续评分', 'info');
            } else {
                UI.addLogMessage('[短语直连] 未直接命中任何短语，启用原短语索引扩展', 'info');
            }

            var phraseIndex = State.jsonData.index.phrase_index || {};
            var expandedTargets = new Set();
            var _arr7 = Array.from(targetWords);
            for (var _i24 = 0; _i24 < _arr7.length; _i24++) {
                var tw = _arr7[_i24];
                var lowerTw = tw.toLowerCase();
                if (phraseIndex[lowerTw]) {
                    for (var _i25 = 0; _i25 < phraseIndex[lowerTw].length; _i25++) {
                        var phrase = phraseIndex[lowerTw][_i25];
                        expandedTargets.add(phrase);
                    }
                }
                var wordInfo = byWord[tw];
                if (wordInfo && wordInfo.is_phrase) {
                    expandedTargets.add(tw);
                }
            }
            if (expandedTargets.size > 0) {
                targetWords = expandedTargets;
                UI.addLogMessage('[短语扩展] 扩展后目标词=' + JSON.stringify(Array.from(targetWords)), 'info');
            } else {
                UI.addLogMessage('[短语扩展] 未能扩展出短语目标词，继续使用原目标词', 'info');
            }
        }

        UI.addLogMessage('[目标] 命中目标词=' + JSON.stringify(Array.from(targetWords)) + ' (共' + targetWords.size + '个)', targetWords.size > 0 ? 'info' : 'warning');

        var bestIndex = 0;
        var bestScore = -1;
        var secondBestScore = -1;
        var scoreDetails = [];

        for (var i2 = 0; i2 < candidates.length; i2++) {
            var candidate2 = candidates[i2];
            if (!candidate2) continue;

            var maxScore = 0;
            var cleanedCandidate = Utils.removePartOfSpeech(candidate2);
            var normalizedCandidate = Utils.normalizeText(cleanedCandidate);
            var candidateKey = Utils.normalizeEntryKey(cleanedCandidate);
            var candidatePosSet = Utils.extractPosSet(candidate2);

            var _arr8 = Array.from(targetWords);
            for (var _i26 = 0; _i26 < _arr8.length; _i26++) {
                var targetWord = _arr8[_i26];
                var wordInfo2 = byWord[targetWord];
                if (!wordInfo2) continue;

                var wordEntry = wordsList.find(function(w3) { return w3.word === targetWord; });

                if (isChineseInput) {
                    var score = 0;
                    var scoreReason = '';

                    if (normalizedCandidate === Utils.normalizeText(targetWord) || candidateKey === Utils.normalizeEntryKey(targetWord)) {
                        score = 100;
                        scoreReason = '完全匹配';
                    } else if (wordEntry && wordEntry.variants.includes(candidate2.trim())) {
                        score = 95;
                        scoreReason = '变体精确匹配';
                    } else if (wordEntry) {
                        for (var _i27 = 0; _i27 < wordEntry.variants.length; _i27++) {
                            var variant2 = wordEntry.variants[_i27];
                            if (Utils.normalizeText(variant2) === normalizedCandidate || Utils.normalizeEntryKey(variant2) === candidateKey) {
                                score = 95;
                                scoreReason = '变体归一化匹配';
                                break;
                            }
                        }
                    }

                    if (score === 0) {
                        var sim = Utils.calculateSimilarity(candidate2, targetWord);
                        if (sim > 50) {
                            score = sim * 0.7;
                            scoreReason = '相似度=' + Math.round(sim) + '*0.7';
                        }
                    }

                    if (score > 0) {
                        var posBonus = Utils.isPosCompatible(candidatePosSet, questionPosSet) ? 1.0 : 0.6;
                        if (posBonus < 1.0) {
                            scoreReason += ' | 词性不兼容*0.6';
                        }
                        score *= posBonus;
                    }

                    if (score > 0) {
                        UI.addLogMessage('[评分] 候选[' + i2 + ']="' + candidate2 + '" vs 目标="' + targetWord + '" → ' + Math.round(score) + '% (' + scoreReason + ')', 'info');
                    }
                    maxScore = Math.max(maxScore, score);
                } else {
                    var score2 = 0;
                    var scoreReason2 = '';

                    for (var _i28 = 0; _i28 < wordInfo2.meanings.length; _i28++) {
                        var meaning = wordInfo2.meanings[_i28];
                        var nm2 = Utils.normalizeText(meaning);
                        if (normalizedCandidate === nm2) {
                            score2 = 100;
                            scoreReason2 = '释义完全匹配="' + meaning + '"';
                            break;
                        }
                        var meaningParts = meaning.split(/[，,、；;]/).map(function(p) { return p.trim(); }).filter(function(p) { return p && p.length >= 1; });
                        for (var pi = 0; pi < meaningParts.length; pi++) {
                            var part = meaningParts[pi];
                            var np = Utils.normalizeText(part);
                            if (np === normalizedCandidate) {
                                var baseScore = (part.length >= 2) ? 90 : 70;
                                if (baseScore > score2) {
                                    score2 = baseScore;
                                    scoreReason2 = '释义分项完全匹配="' + part + '"';
                                }
                            } else if (np && normalizedCandidate && (np.includes(normalizedCandidate) || normalizedCandidate.includes(np))) {
                                var pMinLen = Math.min(normalizedCandidate.length, np.length);
                                var pMaxLen = Math.max(normalizedCandidate.length, np.length);
                                var baseScore2 = (part.length >= 2) ? 90 : 70;
                                var partScore = (pMinLen / pMaxLen) * baseScore2;
                                if (partScore > score2) {
                                    score2 = partScore;
                                    scoreReason2 = '释义分项子串匹配="' + part + '" (' + pMinLen + '/' + pMaxLen + ')';
                                }
                            }
                        }
                        if (score2 === 100) break;
                    }

                    if (score2 === 0) {
                        var bqNorm = byQuestion[normalizedCandidate];
                        if (bqNorm && bqNorm.indexOf(targetWord) !== -1) {
                            score2 = 85;
                            scoreReason2 = 'byQuestion归一化命中';
                        }
                    }
                    if (score2 === 0) {
                        var bqKey = byQuestion[candidateKey];
                        if (bqKey && bqKey.indexOf(targetWord) !== -1) {
                            score2 = 85;
                            scoreReason2 = 'byQuestion entryKey命中';
                        }
                    }

                    if (score2 === 0) {
                        for (var _i29 = 0; _i29 < wordInfo2.meanings.length; _i29++) {
                            var meaning2 = wordInfo2.meanings[_i29];
                            var candChineseLen = (cleanedCandidate.match(/[\u4e00-\u9fff]/g) || []).length;
                            var meanChineseLen = (meaning2.match(/[\u4e00-\u9fff]/g) || []).length;
                            var lenWeight = (candChineseLen > 0 && meanChineseLen > 0)
                                ? Math.sqrt(Math.min(candChineseLen, meanChineseLen) / Math.max(candChineseLen, meanChineseLen))
                                : 1;

                            var overlap = Utils.chineseCharOverlap(cleanedCandidate, meaning2);
                            if (overlap >= 0.3) {
                                var overlapScore = overlap * 80 * lenWeight;
                                if (overlapScore > score2) {
                                    score2 = overlapScore;
                                    scoreReason2 = '汉字重叠=' + Math.round(overlap * 100) + '%*80*权重' + lenWeight.toFixed(2) + ' vs "' + meaning2 + '"';
                                }
                            }
                            var coverage = Utils.chineseCharCoverage(cleanedCandidate, meaning2);
                            if (coverage >= 0.4) {
                                var covScore = coverage * 70 * lenWeight;
                                if (covScore > score2) {
                                    score2 = covScore;
                                    scoreReason2 = '汉字覆盖=' + Math.round(coverage * 100) + '%*70*权重' + lenWeight.toFixed(2) + ' vs "' + meaning2 + '"';
                                }
                            }
                        }
                    }

                    if (score2 === 0) {
                        var sim2 = Utils.calculateSimilarity(cleanedCandidate, cleanedWord);
                        if (sim2 > 30) {
                            score2 = sim2 * 0.3;
                            scoreReason2 = '整体相似度=' + Math.round(sim2) + '*0.3';
                        }
                    }

                    if (score2 > 0) {
                        var posBonus2 = Utils.isPosCompatible(candidatePosSet, questionPosSet) ? 1.0 : 0.6;
                        if (posBonus2 < 1.0) {
                            scoreReason2 += ' | 词性不兼容*0.6';
                        }
                        score2 *= posBonus2;
                    }

                    if (score2 > 0) {
                        UI.addLogMessage('[评分] 候选[' + i2 + ']="' + candidate2 + '" vs 目标="' + targetWord + '" → ' + Math.round(score2) + '% (' + scoreReason2 + ')', 'info');
                    }
                    maxScore = Math.max(maxScore, score2);
                }
            }

            if (targetWords.size === 0) {
                if (isChineseInput) {
                    for (var _i30 = 0; _i30 < wordsList.length; _i30++) {
                        var w4 = wordsList[_i30];
                        var meaningMatch = false;
                        for (var _i31 = 0; _i31 < w4.meanings.length; _i31++) {
                            var meaning3 = w4.meanings[_i31];
                            var nm3 = Utils.normalizeText(meaning3);
                            if (nm3 && normalizedCleaned && (nm3.includes(normalizedCleaned) || normalizedCleaned.includes(nm3))) {
                                meaningMatch = true;
                                break;
                            }
                        }
                        if (meaningMatch) {
                            if (normalizedCandidate === Utils.normalizeText(w4.word) || candidateKey === Utils.normalizeEntryKey(w4.word)) {
                                UI.addLogMessage('[兜底匹配] 候选[' + i2 + ']="' + candidate2 + '" → word="' + w4.word + '" (80%)', 'info');
                                maxScore = Math.max(maxScore, 80);
                            }
                        }
                    }
                } else {
                    for (var _i32 = 0; _i32 < wordsList.length; _i32++) {
                        var w5 = wordsList[_i32];
                        if (Utils.normalizeText(w5.word) === normalizedCleaned || Utils.normalizeEntryKey(w5.word) === entryKeyCleaned) {
                            for (var _i33 = 0; _i33 < w5.meanings.length; _i33++) {
                                var meaning4 = w5.meanings[_i33];
                                var nm4 = Utils.normalizeText(meaning4);
                                if (normalizedCandidate === nm4) {
                                    UI.addLogMessage('[兜底匹配] 候选[' + i2 + ']="' + candidate2 + '" → 释义完全匹配 (100%)', 'info');
                                    maxScore = Math.max(maxScore, 100);
                                } else {
                                    var dbParts = meaning4.split(/[，,、；;]/).map(function(p) { return p.trim(); }).filter(function(p) { return p && p.length >= 1; });
                                    for (var dpi = 0; dpi < dbParts.length; dpi++) {
                                        var dbPart = dbParts[dpi];
                                        var dbnp = Utils.normalizeText(dbPart);
                                        if (dbnp === normalizedCandidate) {
                                            var dbBase = (dbPart.length >= 2) ? 90 : 70;
                                            UI.addLogMessage('[兜底匹配] 候选[' + i2 + ']="' + candidate2 + '" → 释义分项完全匹配="' + dbPart + '" (' + dbBase + '%)', 'info');
                                            maxScore = Math.max(maxScore, dbBase);
                                        } else if (dbnp && normalizedCandidate && (dbnp.includes(normalizedCandidate) || normalizedCandidate.includes(dbnp))) {
                                            var dpMin = Math.min(normalizedCandidate.length, dbnp.length);
                                            var dpMax = Math.max(normalizedCandidate.length, dbnp.length);
                                            var dbBase2 = (dbPart.length >= 2) ? 90 : 70;
                                            var dpScore = (dpMin / dpMax) * dbBase2;
                                            if (dpScore > maxScore) {
                                                UI.addLogMessage('[兜底匹配] 候选[' + i2 + ']="' + candidate2 + '" → 释义分项子串匹配="' + dbPart + '" (' + Math.round(dpScore) + '%)', 'info');
                                                maxScore = dpScore;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (maxScore < 20 && isChineseInput) {
                var chineseChars = (cleanedCandidate.match(/[\u4e00-\u9fff]/g) || []);
                if (chineseChars.length >= 2) {
                    var appearsInOther = false;
                    var appearsInSelf = false;
                    for (var _i34 = 0; _i34 < wordsList.length; _i34++) {
                        var w6 = wordsList[_i34];
                        for (var _i35 = 0; _i35 < w6.meanings.length; _i35++) {
                            var meaning5 = w6.meanings[_i35];
                            if (meaning5.includes(cleanedCandidate)) {
                                if (targetWords.has(w6.word)) {
                                    appearsInSelf = true;
                                } else {
                                    appearsInOther = true;
                                }
                                break;
                            }
                        }
                    }
                    if (appearsInOther && !appearsInSelf) {
                        UI.addLogMessage('[惩罚] 候选[' + i2 + ']="' + candidate2 + '" 出现在其他词条释义中，降权*0.2', 'warning');
                        maxScore *= 0.2;
                    } else if (!appearsInOther && !appearsInSelf) {
                        maxScore = Math.max(maxScore, 15);
                    }
                }
            }

            scoreDetails.push({ index: i2, candidate: candidate2, score: maxScore });

            if (maxScore > bestScore) {
                secondBestScore = bestScore;
                bestScore = maxScore;
                bestIndex = i2;
            } else if (maxScore > secondBestScore) {
                secondBestScore = maxScore;
            }
        }

        var scoreGap = bestScore - secondBestScore;

        UI.addLogMessage('[结果] 所有候选评分: ' + scoreDetails.map(function(s) { return '[' + s.index + ']' + s.candidate + '=' + Math.round(s.score) + '%'; }).join(' | '), 'info');
        State.lastMatchScores = scoreDetails.slice();

        if (isChineseInput && bestScore === 0 && targetWords.size > 0) {
            UI.addLogMessage('[反向查库] 中文→英文方向首轮全部0分，启用候选反向查词库', 'info');
            for (var ri = 0; ri < candidates.length; ri++) {
                var rCand = candidates[ri];
                if (!rCand) continue;
                var rCleaned = Utils.removePartOfSpeech(rCand);
                var rNorm = Utils.normalizeText(rCleaned);
                var rKey = Utils.normalizeEntryKey(rCleaned);
                var rInfo = byWord[rCleaned] || byWord[rNorm] || byWord[rKey];
                if (!rInfo) continue;
                var rMaxScore = 0;
                var rReason = '';
                for (var rmi = 0; rmi < rInfo.meanings.length; rmi++) {
                    var rMeaning = rInfo.meanings[rmi];
                    var rnm = Utils.normalizeText(rMeaning);
                    if (rnm === normalizedCleaned) {
                        rMaxScore = 85;
                        rReason = '反向释义完全匹配="' + rMeaning + '"';
                        break;
                    }
                    var rParts = rMeaning.split(/[，,、；;]/).map(function(p) { return p.trim(); }).filter(function(p) { return p && p.length >= 1; });
                    for (var rpi = 0; rpi < rParts.length; rpi++) {
                        var rPart = rParts[rpi];
                        var rpNorm = Utils.normalizeText(rPart);
                        if (rpNorm === normalizedCleaned) {
                            rMaxScore = 85;
                            rReason = '反向分项完全匹配="' + rPart + '"';
                            break;
                        } else if (rpNorm && normalizedCleaned && (rpNorm.includes(normalizedCleaned) || normalizedCleaned.includes(rpNorm))) {
                            var rpMin = Math.min(normalizedCleaned.length, rpNorm.length);
                            var rpMax = Math.max(normalizedCleaned.length, rpNorm.length);
                            var rpScore = (rpMin / rpMax) * 80;
                            if (rpScore > rMaxScore) {
                                rMaxScore = rpScore;
                                rReason = '反向分项子串匹配="' + rPart + '" (' + rpMin + '/' + rpMax + ')';
                            }
                        }
                    }
                    if (rMaxScore >= 85) break;
                }
                if (rMaxScore > 0) {
                    var rPosSet = Utils.extractPosSet(rCand);
                    var rPosBonus = Utils.isPosCompatible(rPosSet, questionPosSet) ? 1.0 : 0.6;
                    rMaxScore *= rPosBonus;
                    UI.addLogMessage('[反向查库] 候选[' + ri + ']="' + rCand + '" → ' + Math.round(rMaxScore) + '% (' + rReason + ')', 'info');
                }
                if (rMaxScore > bestScore) {
                    secondBestScore = bestScore;
                    bestScore = rMaxScore;
                    bestIndex = ri;
                } else if (rMaxScore > secondBestScore) {
                    secondBestScore = rMaxScore;
                }
            }
            scoreGap = bestScore - secondBestScore;
        }

        if (!isChineseInput && (bestScore < 50 || scoreGap < 15) && targetWords.size > 0) {
            UI.addLogMessage('[二轮兜底] 首轮不可信 (最佳=' + Math.round(bestScore) + '%, 分差=' + Math.round(scoreGap) + ')，启用纯净释义二轮匹配', 'info');

            var round2BestIndex = bestIndex;
            var round2BestScore = bestScore;

            for (var i3 = 0; i3 < candidates.length; i3++) {
                var candidate3 = candidates[i3];
                if (!candidate3) continue;

                var maxScore2 = 0;
                var cleanedCandidate2 = Utils.removePartOfSpeech(candidate3);
                var normalizedCandidate2 = Utils.normalizeText(cleanedCandidate2);

                var _arr9 = Array.from(targetWords);
                for (var _i36 = 0; _i36 < _arr9.length; _i36++) {
                    var targetWord2 = _arr9[_i36];
                    var wordInfo3 = byWord[targetWord2];
                    if (!wordInfo3 || !wordInfo3.clean_meanings) continue;

                    for (var _i37 = 0; _i37 < wordInfo3.clean_meanings.length; _i37++) {
                        var cleanMeaning = wordInfo3.clean_meanings[_i37];
                        var ncm = Utils.normalizeText(cleanMeaning);
                        if (normalizedCandidate2 === ncm) {
                            maxScore2 = Math.max(maxScore2, 100);
                        } else {
                            var r2Parts = cleanMeaning.split(/[，,、；;]/).map(function(p) { return p.trim(); }).filter(function(p) { return p && p.length >= 1; });
                            for (var r2pi = 0; r2pi < r2Parts.length; r2pi++) {
                                var r2Part = r2Parts[r2pi];
                                var r2np = Utils.normalizeText(r2Part);
                                if (r2np === normalizedCandidate2) {
                                    var r2Base = (r2Part.length >= 2) ? 90 : 70;
                                    maxScore2 = Math.max(maxScore2, r2Base);
                                } else if (r2np && normalizedCandidate2 && (r2np.includes(normalizedCandidate2) || normalizedCandidate2.includes(r2np))) {
                                    var r2Min = Math.min(normalizedCandidate2.length, r2np.length);
                                    var r2Max = Math.max(normalizedCandidate2.length, r2np.length);
                                    var r2Base2 = (r2Part.length >= 2) ? 90 : 70;
                                    var r2Score = (r2Min / r2Max) * r2Base2;
                                    maxScore2 = Math.max(maxScore2, r2Score);
                                }
                            }
                        }
                    }
                }

                if (maxScore2 > round2BestScore) {
                    round2BestScore = maxScore2;
                    round2BestIndex = i3;
                }
            }

            if (round2BestScore > bestScore) {
                UI.addLogMessage('[二轮兜底] 二轮结果更优: [' + round2BestIndex + ']' + candidates[round2BestIndex] + ' (' + Math.round(round2BestScore) + '% > ' + Math.round(bestScore) + '%)', 'match');
                bestIndex = round2BestIndex;
                bestScore = round2BestScore;
            } else {
                UI.addLogMessage('[二轮兜底] 二轮未改善，保留首轮结果', 'info');
            }
        }

        if (bestScore >= 90 || scoreGap >= 10) {
            UI.addLogMessage('选择答案: [' + bestIndex + '] ' + candidates[bestIndex] + ' (匹配度: ' + Math.round(bestScore) + '%, 置信度: ' + Math.round(scoreGap) + ')', 'match');
            State.matchCount++;
            return bestIndex >= 0 ? bestIndex : 0;
        } else if (bestScore >= 15) {
            var confLevel = (bestScore >= 40 && scoreGap >= 5) ? '中置信' : '低置信';
            UI.addLogMessage('选择答案(' + confLevel + '): [' + bestIndex + '] ' + candidates[bestIndex] + ' (匹配度: ' + Math.round(bestScore) + '%, 置信度: ' + Math.round(scoreGap) + ')', 'warning');
            State.matchCount++;
            return bestIndex >= 0 ? bestIndex : 0;
        } else {
            UI.addLogMessage('匹配度不够高，保持默认选择: [' + 0 + '] ' + candidates[0] + ' (最佳匹配度: ' + Math.round(bestScore) + '%, 次佳: ' + Math.round(secondBestScore) + '%)', 'warning');
            State.missCount++;
            UI.addLogMessage('[统计] 命中=' + State.matchCount + ' | 未命中=' + State.missCount + ' | 命中率=' + (State.matchCount + State.missCount > 0 ? Math.round(State.matchCount / (State.matchCount + State.missCount) * 100) : 0) + '%', 'info');
            return 0;
        }
    }
};

var MatcherSimple = {
    build: function(entryList) {
        var words = [];
        var byQuestion = {};
        var byWord = {};
        var seen = new Set();
        var duplicateCount = 0;

        for (var i = 0; i < entryList.length; i++) {
            var rawEntry = entryList[i];
            var std = MatcherFull.standardizeEntry(rawEntry);
            var extraKeys = [];
            for (var cm = 0; cm < std.clean_meanings.length; cm++) {
                var cleanM = std.clean_meanings[cm];
                extraKeys.push(cleanM);
                var cmParts = cleanM.split(/[，,、]/);
                for (var cp = 0; cp < cmParts.length; cp++) {
                    var cmPart = cmParts[cp].trim();
                    if (cmPart && cmPart.length >= 1) {
                        extraKeys.push(cmPart);
                        var noPosPart = cmPart.replace(/^[a-z]+(?:\s+[a-z]+)*\.\s*/, '').trim();
                        if (noPosPart && noPosPart !== cmPart) extraKeys.push(noPosPart);
                    }
                }
            }
            for (var pm = 0; pm < std.meanings.length; pm++) {
                var pmItem = std.meanings[pm];
                var mvMatch = pmItem.match(/^modal\s+(?:verb|v)\.\s*/i);
                if (mvMatch) {
                    if (std.pos.indexOf('modal verb') === -1) std.pos.push('modal verb');
                    if (std.pos.indexOf('v') === -1) std.pos.push('v');
                    var afterMV = pmItem.substring(mvMatch[0].length).trim();
                    afterMV = afterMV.replace(/[\(（][^\)）]*[\)）]/g, '').trim();
                    if (afterMV) {
                        extraKeys.push(afterMV);
                        var afterParts = afterMV.split(/[，,、]/);
                        for (var ap = 0; ap < afterParts.length; ap++) {
                            var afterPart = afterParts[ap].trim();
                            if (afterPart) extraKeys.push(afterPart);
                        }
                    }
                }
            }
            for (var eki = 0; eki < extraKeys.length; eki++) {
                if (extraKeys[eki] && std.match_keys.indexOf(extraKeys[eki]) === -1) {
                    std.match_keys.push(extraKeys[eki]);
                }
            }
            var dedupeKey = std.word + '_' + std.meaning_text;
            if (seen.has(dedupeKey)) {
                duplicateCount++;
                continue;
            }
            seen.add(dedupeKey);
            words.push(std);

            for (var j = 0; j < std.match_keys.length; j++) {
                var mk = std.match_keys[j];
                if (mk) {
                    if (!byQuestion[mk]) byQuestion[mk] = [];
                    if (byQuestion[mk].indexOf(std.word) === -1) byQuestion[mk].push(std.word);
                }
                var nk = Utils.normalizeText(mk);
                if (nk) {
                    if (!byQuestion[nk]) byQuestion[nk] = [];
                    if (byQuestion[nk].indexOf(std.word) === -1) byQuestion[nk].push(std.word);
                }
                var ek = Utils.normalizeEntryKey(mk);
                if (ek && ek !== nk) {
                    if (!byQuestion[ek]) byQuestion[ek] = [];
                    if (byQuestion[ek].indexOf(std.word) === -1) byQuestion[ek].push(std.word);
                }
            }

            for (var k = 0; k < std.variants.length; k++) {
                var v = std.variants[k];
                if (v) {
                    if (!byQuestion[v]) byQuestion[v] = [];
                    if (byQuestion[v].indexOf(std.word) === -1) byQuestion[v].push(std.word);
                }
                var nv = Utils.normalizeText(v);
                if (nv) {
                    if (!byQuestion[nv]) byQuestion[nv] = [];
                    if (byQuestion[nv].indexOf(std.word) === -1) byQuestion[nv].push(std.word);
                }
                var ev = Utils.normalizeEntryKey(v);
                if (ev) {
                    if (!byQuestion[ev]) byQuestion[ev] = [];
                    if (byQuestion[ev].indexOf(std.word) === -1) byQuestion[ev].push(std.word);
                }
            }

            if (!byWord[std.word]) {
                byWord[std.word] = {
                    pos: std.pos,
                    meanings: std.meanings,
                    clean_meanings: std.clean_meanings,
                    is_phrase: std.is_phrase
                };
            }
        }

        UI.addLogMessage('[Simple] 词库标准化完成: 原始 ' + entryList.length + ' 条 → 标准化后 ' + words.length + ' 条 (去重 ' + duplicateCount + ' 条)', 'info');
        UI.addLogMessage('[Simple] [索引] byQuestion键数=' + Object.keys(byQuestion).length + ' | byWord键数=' + Object.keys(byWord).length, 'info');

        return {
            version: '3.6',
            index: {
                by_question: byQuestion,
                by_word: byWord,
                phrase_index: {}
            },
            words: words
        };
    },

    match: function(word, candidates) {
        if (!State.jsonData || !State.jsonData.version || State.jsonData.version !== '3.6') {
            UI.addLogMessage('[Simple] 词库未就绪，跳过匹配', 'warning');
            State.lastMatchScores = [];
            return 0;
        }

        candidates = candidates.map(function(c) { return Utils.decodeHtmlEntities(c); });

        var byQuestion = State.jsonData.index.by_question;
        var byWord = State.jsonData.index.by_word;
        var wordsList = State.jsonData.words;

        var isChineseInput = /[\u4e00-\u9fff]/.test(word);
        var questionPosSet = Utils.extractPosSet(word);
        var cleanedWord = Utils.removePartOfSpeech(word);
        var normalizedWord = Utils.normalizeText(word);
        var normalizedCleaned = Utils.normalizeText(cleanedWord);
        var entryKeyWord = Utils.normalizeEntryKey(word);
        var entryKeyCleaned = Utils.normalizeEntryKey(cleanedWord);

        var modalVerbDetected = /^modal\s+(?:verb|v)\./i.test(word);
        if (modalVerbDetected) {
            questionPosSet.delete('other');
            questionPosSet.add('v');
            questionPosSet.add('modal verb');
        }

        UI.addLogMessage('[Simple] 原始题目="' + word + '" | 是否中文=' + isChineseInput + ' | 清理后="' + cleanedWord + '" | 归一化="' + normalizedCleaned + '" | entryKey="' + entryKeyCleaned + '"' + (modalVerbDetected ? ' | modal verb已识别' : ''), 'info');
        UI.addLogMessage('[Simple] 题目词性=' + JSON.stringify(Array.from(questionPosSet)) + ' | 候选数=' + candidates.length, 'info');

        var targetWords = new Set();

        var lookupKeys = [word, normalizedWord, cleanedWord, normalizedCleaned, entryKeyWord, entryKeyCleaned];
        for (var i = 0; i < lookupKeys.length; i++) {
            var key = lookupKeys[i];
            if (key && byQuestion[key]) {
                var matchedWords = byQuestion[key];
                for (var mw = 0; mw < matchedWords.length; mw++) {
                    targetWords.add(matchedWords[mw]);
                    UI.addLogMessage('[Simple] [索引命中] key="' + key + '" → word="' + matchedWords[mw] + '"', 'info');
                }
            }
        }

        if (isChineseInput) {
            UI.addLogMessage('[Simple] [子串补充] 中文输入，遍历词库进行子串匹配补充... (当前目标数=' + targetWords.size + ')', 'info');
            for (var j = 0; j < wordsList.length; j++) {
                var w = wordsList[j];
                var checkList = (w.clean_meanings || []).concat(w.meanings).concat(w.match_keys);
                var matched = false;
                for (var k = 0; k < checkList.length; k++) {
                    var item = checkList[k];
                    var nm = Utils.normalizeText(item);
                    if (nm && normalizedCleaned && (nm.includes(normalizedCleaned) || normalizedCleaned.includes(nm))) {
                        targetWords.add(w.word);
                        matched = true;
                        break;
                    }
                }
                if (matched) {
                    UI.addLogMessage('[Simple] [子串匹配] 命中: ' + w.word, 'info');
                }
            }
        }

        if (!isChineseInput && targetWords.size === 0) {
            UI.addLogMessage('[Simple] [索引未命中] 英文输入，遍历词库进行单词/变体匹配...', 'info');
            for (var m = 0; m < wordsList.length; m++) {
                var w2 = wordsList[m];
                if (Utils.normalizeText(w2.word) === normalizedCleaned || Utils.normalizeEntryKey(w2.word) === entryKeyCleaned) {
                    targetWords.add(w2.word);
                }
                for (var n = 0; n < w2.variants.length; n++) {
                    var variant = w2.variants[n];
                    if (Utils.normalizeText(variant) === normalizedCleaned || Utils.normalizeEntryKey(variant) === entryKeyCleaned) {
                        targetWords.add(w2.word);
                    }
                }
            }
        }

        if (targetWords.size > 1 && questionPosSet.size > 0 && !questionPosSet.has('other')) {
            var posFiltered = new Set();
            var targetArr0 = Array.from(targetWords);
            for (var di = 0; di < targetArr0.length; di++) {
                var tw = targetArr0[di];
                var twInfo = byWord[tw];
                if (twInfo) {
                    var twPosSet = new Set(twInfo.pos.map(function(p) { return p.replace(/\./g, '').toLowerCase().replace(/^vt$|^vi$/, 'v'); }));
                    var posMatch = false;
                    var qPosArr = Array.from(questionPosSet);
                    for (var qi = 0; qi < qPosArr.length; qi++) {
                        if (twPosSet.has(qPosArr[qi])) {
                            posMatch = true;
                            break;
                        }
                    }
                    if (posMatch) posFiltered.add(tw);
                }
            }
            if (posFiltered.size > 0 && posFiltered.size < targetWords.size) {
                targetWords = posFiltered;
                UI.addLogMessage('[Simple] [词性消歧] 根据题目词性筛选后目标=' + JSON.stringify(Array.from(targetWords)), 'info');
            }
        }

        UI.addLogMessage('[Simple] [目标] 命中目标词=' + JSON.stringify(Array.from(targetWords)) + ' (共' + targetWords.size + '个)', targetWords.size > 0 ? 'info' : 'warning');

        var bestIndex = 0;
        var bestScore = -1;
        var secondBestScore = -1;
        var scoreDetails = [];

        for (var ci = 0; ci < candidates.length; ci++) {
            var candidate = candidates[ci];
            if (!candidate) continue;

            var maxScore = 0;
            var cleanedCandidate = Utils.removePartOfSpeech(candidate);
            var normalizedCandidate = Utils.normalizeText(cleanedCandidate);
            var candidateKey = Utils.normalizeEntryKey(cleanedCandidate);
            var candidatePosSet = Utils.extractPosSet(candidate);

            var targetArr = Array.from(targetWords);
            for (var ti = 0; ti < targetArr.length; ti++) {
                var targetWord = targetArr[ti];
                var wordInfo = byWord[targetWord];
                if (!wordInfo) continue;

                var wordEntry = null;
                for (var wi = 0; wi < wordsList.length; wi++) {
                    if (wordsList[wi].word === targetWord) {
                        wordEntry = wordsList[wi];
                        break;
                    }
                }

                if (isChineseInput) {
                    var score = 0;
                    var scoreReason = '';

                    if (candidateKey === Utils.normalizeEntryKey(targetWord)) {
                        score = 100;
                        scoreReason = '完全匹配';
                    } else if (wordEntry && wordEntry.variants.indexOf(candidate.trim()) !== -1) {
                        score = 95;
                        scoreReason = '变体精确匹配';
                    } else if (wordEntry) {
                        for (var vi = 0; vi < wordEntry.variants.length; vi++) {
                            var v = wordEntry.variants[vi];
                            if (Utils.normalizeEntryKey(v) === candidateKey) {
                                score = 95;
                                scoreReason = '变体归一化匹配';
                                break;
                            }
                        }
                    }

                    if (score === 0) {
                        var sim = Utils.calculateSimilarity(candidate, targetWord);
                        if (sim > 50) {
                            score = sim * 0.7;
                            scoreReason = '相似度=' + Math.round(sim) + '*0.7';
                        }
                    }

                    if (score > 0) {
                        var posBonus = Utils.isPosCompatible(candidatePosSet, questionPosSet) ? 1.0 : 0.6;
                        if (posBonus < 1.0) {
                            scoreReason += ' | 词性不兼容*0.6';
                        }
                        score *= posBonus;
                    }

                    if (score > 0) {
                        UI.addLogMessage('[Simple] [评分] 候选[' + ci + ']="' + candidate + '" vs 目标="' + targetWord + '" → ' + Math.round(score) + '% (' + scoreReason + ')', 'info');
                    }
                    maxScore = Math.max(maxScore, score);
                } else {
                    var score2 = 0;
                    var scoreReason2 = '';

                    for (var mi = 0; mi < wordInfo.meanings.length; mi++) {
                        var meaning = wordInfo.meanings[mi];
                        var nm = Utils.normalizeText(meaning);
                        if (normalizedCandidate === nm) {
                            score2 = 100;
                            scoreReason2 = '释义完全匹配="' + meaning + '"';
                            break;
                        }
                    }

                    if (score2 < 90) {
                        var meaningsFG = (wordInfo.clean_meanings || []).concat(wordInfo.meanings);
                        for (var miFG = 0; miFG < meaningsFG.length; miFG++) {
                            var mFG = meaningsFG[miFG];
                            var commaParts = mFG.split(/[，,、]/);
                            for (var cp = 0; cp < commaParts.length; cp++) {
                                var commaPart = commaParts[cp].trim();
                                var posParts = commaPart.split(/\s+(?=[a-z]+\.)/);
                                for (var pp = 0; pp < posParts.length; pp++) {
                                    var finePart = posParts[pp].trim().replace(/^[a-z]+\.\s*/, '');
                                    if (!finePart) continue;
                                    var nfp = Utils.normalizeText(finePart);
                                    if (!nfp) continue;

                                    if (normalizedCandidate === nfp) {
                                        score2 = 95;
                                        scoreReason2 = '细粒度完全匹配="' + finePart + '"';
                                        break;
                                    }
                                    if (nfp && normalizedCandidate && (nfp.includes(normalizedCandidate) || normalizedCandidate.includes(nfp))) {
                                        var fpMinLen = Math.min(normalizedCandidate.length, nfp.length);
                                        var fpMaxLen = Math.max(normalizedCandidate.length, nfp.length);
                                        var fpScore = (fpMinLen / fpMaxLen) * 90;
                                        if (fpScore > score2) {
                                            score2 = fpScore;
                                            scoreReason2 = '细粒度子串匹配="' + finePart + '" (' + fpMinLen + '/' + fpMaxLen + ')';
                                        }
                                    }
                                }
                                if (score2 >= 95) break;
                            }
                            if (score2 >= 95) break;
                        }
                    }

                    if (score2 === 0) {
                        for (var mi3 = 0; mi3 < wordInfo.meanings.length; mi3++) {
                            var meaning3 = wordInfo.meanings[mi3];
                            var nm3 = Utils.normalizeText(meaning3);
                            if (nm3 && normalizedCandidate) {
                                if (nm3.includes(normalizedCandidate) || normalizedCandidate.includes(nm3)) {
                                    var minLen3 = Math.min(normalizedCandidate.length, nm3.length);
                                    var maxLen3 = Math.max(normalizedCandidate.length, nm3.length);
                                    var subScore3 = (minLen3 / maxLen3) * 90;
                                    if (subScore3 > score2) {
                                        score2 = subScore3;
                                        scoreReason2 = '释义子串匹配="' + meaning3 + '" (' + minLen3 + '/' + maxLen3 + ')';
                                    }
                                }
                            }
                        }
                    }

                    if (score2 < 85) {
                        if (byQuestion[normalizedCandidate]) {
                            var bqWords = byQuestion[normalizedCandidate];
                            for (var bq = 0; bq < bqWords.length; bq++) {
                                if (bqWords[bq] === targetWord) {
                                    if (85 > score2) {
                                        score2 = 85;
                                        scoreReason2 = 'byQuestion归一化命中';
                                    }
                                    break;
                                }
                            }
                        }
                        if (score2 < 85 && byQuestion[candidateKey]) {
                            var bqWords2 = byQuestion[candidateKey];
                            for (var bq2 = 0; bq2 < bqWords2.length; bq2++) {
                                if (bqWords2[bq2] === targetWord) {
                                    score2 = 85;
                                    scoreReason2 = 'byQuestion entryKey命中';
                                    break;
                                }
                            }
                        }
                    }

                    if (score2 === 0) {
                        for (var mi2 = 0; mi2 < wordInfo.meanings.length; mi2++) {
                            var meaning2 = wordInfo.meanings[mi2];
                            var candChineseLen = (cleanedCandidate.match(/[\u4e00-\u9fff]/g) || []).length;
                            var meanChineseLen = (meaning2.match(/[\u4e00-\u9fff]/g) || []).length;
                            var lenWeight = (candChineseLen > 0 && meanChineseLen > 0)
                                ? Math.sqrt(Math.min(candChineseLen, meanChineseLen) / Math.max(candChineseLen, meanChineseLen))
                                : 1;

                            var overlap = Utils.chineseCharOverlap(cleanedCandidate, meaning2);
                            if (overlap >= 0.3) {
                                var overlapScore = overlap * 80 * lenWeight;
                                if (overlapScore > score2) {
                                    score2 = overlapScore;
                                    scoreReason2 = '汉字重叠=' + Math.round(overlap * 100) + '%*80*权重' + lenWeight.toFixed(2) + ' vs "' + meaning2 + '"';
                                }
                            }
                        }
                    }

                    if (score2 === 0) {
                        var sim2 = Utils.calculateSimilarity(cleanedCandidate, cleanedWord);
                        if (sim2 > 30) {
                            score2 = sim2 * 0.3;
                            scoreReason2 = '整体相似度=' + Math.round(sim2) + '*0.3';
                        }
                    }

                    if (score2 > 0) {
                        var posBonus2 = Utils.isPosCompatible(candidatePosSet, questionPosSet) ? 1.0 : 0.6;
                        if (posBonus2 < 1.0) {
                            scoreReason2 += ' | 词性不兼容*0.6';
                        }
                        score2 *= posBonus2;
                    }

                    if (score2 > 0) {
                        UI.addLogMessage('[Simple] [评分] 候选[' + ci + ']="' + candidate + '" vs 目标="' + targetWord + '" → ' + Math.round(score2) + '% (' + scoreReason2 + ')', 'info');
                    }
                    maxScore = Math.max(maxScore, score2);
                }
            }

            if (targetWords.size === 0) {
                if (isChineseInput) {
                    for (var fi = 0; fi < wordsList.length; fi++) {
                        var fw = wordsList[fi];
                        var meaningMatch = false;
                        for (var fj = 0; fj < fw.meanings.length; fj++) {
                            var fm = fw.meanings[fj];
                            var fnm = Utils.normalizeText(fm);
                            if (fnm && normalizedCleaned && (fnm.includes(normalizedCleaned) || normalizedCleaned.includes(fnm))) {
                                meaningMatch = true;
                                break;
                            }
                        }
                        if (meaningMatch) {
                            if (normalizedCandidate === Utils.normalizeText(fw.word) || candidateKey === Utils.normalizeEntryKey(fw.word)) {
                                UI.addLogMessage('[Simple] [兜底匹配] 候选[' + ci + ']="' + candidate + '" → word="' + fw.word + '" (80%)', 'info');
                                maxScore = Math.max(maxScore, 80);
                            }
                        }
                    }
                } else {
                    for (var ei = 0; ei < wordsList.length; ei++) {
                        var ew = wordsList[ei];
                        var wordMatch = Utils.normalizeText(ew.word) === normalizedCleaned || Utils.normalizeEntryKey(ew.word) === entryKeyCleaned;
                        if (!wordMatch) {
                            for (var evi = 0; evi < ew.variants.length; evi++) {
                                var ev = ew.variants[evi];
                                if (Utils.normalizeText(ev) === normalizedCleaned || Utils.normalizeEntryKey(ev) === entryKeyCleaned) {
                                    wordMatch = true;
                                    break;
                                }
                            }
                        }
                        if (wordMatch) {
                            for (var emi = 0; emi < ew.meanings.length; emi++) {
                                var em = ew.meanings[emi];
                                var enm = Utils.normalizeText(em);
                                if (normalizedCandidate === enm) {
                                    UI.addLogMessage('[Simple] [兜底匹配] 候选[' + ci + ']="' + candidate + '" → 释义完全匹配 (100%)', 'info');
                                    maxScore = Math.max(maxScore, 100);
                                } else if (enm && normalizedCandidate && (enm.includes(normalizedCandidate) || normalizedCandidate.includes(enm))) {
                                    var eMinLen = Math.min(normalizedCandidate.length, enm.length);
                                    var eMaxLen = Math.max(normalizedCandidate.length, enm.length);
                                    var eSubScore = (eMinLen / eMaxLen) * 90;
                                    UI.addLogMessage('[Simple] [兜底匹配] 候选[' + ci + ']="' + candidate + '" → 释义子串匹配 (' + Math.round(eSubScore) + '%)', 'info');
                                    maxScore = Math.max(maxScore, eSubScore);
                                }
                            }
                        }
                    }
                }
            }

            if (isChineseInput && maxScore < 50) {
                var candWInfo = byWord[cleanedCandidate];
                if (!candWInfo) {
                    for (var cwi = 0; cwi < wordsList.length; cwi++) {
                        if (Utils.normalizeEntryKey(wordsList[cwi].word) === candidateKey) {
                            candWInfo = byWord[wordsList[cwi].word];
                            break;
                        }
                    }
                }
                if (candWInfo) {
                    var mtcList = (candWInfo.clean_meanings || []).concat(candWInfo.meanings);
                    for (var mci = 0; mci < mtcList.length; mci++) {
                        var mcItem = mtcList[mci];
                        var mcClean = Utils.removePartOfSpeech(mcItem);
                        var mcFineParts = mcClean.split(/[，,、]/);
                        for (var mcfp = 0; mcfp < mcFineParts.length; mcfp++) {
                            var finePart = mcFineParts[mcfp].trim();
                            var fpNorm = Utils.normalizeText(finePart);
                            if (fpNorm && normalizedCleaned) {
                                if (fpNorm === normalizedCleaned) {
                                    maxScore = Math.max(maxScore, 92);
                                    UI.addLogMessage('[Simple] [释义匹配] 候选[' + ci + ']="' + candidate + '" 释义细粒度完全匹配 (92%)', 'info');
                                    break;
                                }
                                if (fpNorm.includes(normalizedCleaned) || normalizedCleaned.includes(fpNorm)) {
                                    var fpMinLen = Math.min(fpNorm.length, normalizedCleaned.length);
                                    var fpMaxLen = Math.max(fpNorm.length, normalizedCleaned.length);
                                    var fpScore = (fpMinLen / fpMaxLen) * 85;
                                    if (fpScore > maxScore) {
                                        maxScore = fpScore;
                                        UI.addLogMessage('[Simple] [释义匹配] 候选[' + ci + ']="' + candidate + '" 释义细粒度子串匹配 (' + Math.round(fpScore) + '%)', 'info');
                                    }
                                }
                            }
                        }
                        if (maxScore >= 90) break;
                    }
                    if (maxScore > 0 && maxScore < 90) {
                        var candPosSet2 = Utils.extractPosSet(candidate);
                        if (!Utils.isPosCompatible(candPosSet2, questionPosSet)) {
                            maxScore *= 0.7;
                        }
                    }
                }
            }

            scoreDetails.push({ index: ci, candidate: candidate, score: maxScore });

            if (maxScore > bestScore) {
                secondBestScore = bestScore;
                bestScore = maxScore;
                bestIndex = ci;
            } else if (maxScore > secondBestScore) {
                secondBestScore = maxScore;
            }
        }

        var scoreGap = bestScore - secondBestScore;

        UI.addLogMessage('[Simple] [结果] 所有候选评分: ' + scoreDetails.map(function(s) { return '[' + s.index + ']' + s.candidate + '=' + Math.round(s.score) + '%'; }).join(' | '), 'info');
        State.lastMatchScores = scoreDetails.slice();

        if (bestScore >= 90 || scoreGap >= 10) {
            UI.addLogMessage('[Simple] 选择答案: [' + bestIndex + '] ' + candidates[bestIndex] + ' (匹配度: ' + Math.round(bestScore) + '%, 置信度: ' + Math.round(scoreGap) + ')', 'match');
            State.matchCount++;
            return bestIndex >= 0 ? bestIndex : 0;
        } else {
            UI.addLogMessage('[Simple] 匹配度不够高，保持默认选择: [0] ' + candidates[0] + ' (最佳匹配度: ' + Math.round(bestScore) + '%, 次佳: ' + Math.round(secondBestScore) + '%)', 'warning');
            State.missCount++;
            UI.addLogMessage('[Simple] [统计] 命中=' + State.matchCount + ' | 未命中=' + State.missCount + ' | 命中率=' + (State.matchCount + State.missCount > 0 ? Math.round(State.matchCount / (State.matchCount + State.missCount) * 100) : 0) + '%', 'info');
            return 0;
        }
    }
};

var ScoreControl = {
    getTargetCorrect: function() {
        if (State.scoreControlMode === 'count') {
            return State.targetCorrectCount;
        }
        if (State.totalWordsInBucket <= 0) return 0;
        return Math.ceil(State.totalWordsInBucket * State.targetScoreRate / 100);
    },

    shouldIntentionallyMiss: function() {
        if (!State.scoreControlEnabled) return false;
        var target = ScoreControl.getTargetCorrect();
        if (target <= 0) return false;
        if (State.scoreControlActive) return true;
        if (State.answeredCorrectly >= target) {
            State.scoreControlActive = true;
            UI.addLogMessage('[分数控制] 已达目标正确数 ' + State.answeredCorrectly + '/' + target + '，切换为故意选错模式', 'warning');
            return true;
        }
        return false;
    },

    recordAnswer: function(confidence) {
        State.answeredTotal++;
        if (confidence >= 50) {
            State.answeredCorrectly++;
        }
    },

    findWorstCandidateIndex: function() {
        if (!State.lastMatchScores || State.lastMatchScores.length === 0) return 0;
        var worst = State.lastMatchScores[0];
        for (var i = 1; i < State.lastMatchScores.length; i++) {
            if (State.lastMatchScores[i].score < worst.score) {
                worst = State.lastMatchScores[i];
            }
        }
        return worst.index;
    },

    reset: function() {
        State.answeredCorrectly = 0;
        State.answeredTotal = 0;
        State.scoreControlActive = false;
    },

    getProgressText: function() {
        var target = ScoreControl.getTargetCorrect();
        if (target <= 0) return '目标未设置';
        var pct = target > 0 ? Math.round(State.answeredCorrectly / target * 100) : 0;
        return '正确: ' + State.answeredCorrectly + '/' + target + ' (' + pct + '%)' + (State.scoreControlActive ? ' [故意选错中]' : '');
    }
};

var AIFallback = {
    query: function(question, candidates) {
        return new Promise(function(resolve, reject) {
            var bucketPort = localStorage.getItem('bucket-port') || '5290';
            var keyUrl = 'http://127.0.0.1:' + bucketPort + '/ai-api-key';
            fetch(keyUrl, { cache: 'no-cache' })
                .then(function(res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
                .then(function(data) {
                    if (data && typeof data.key === 'string') {
                        State.aiApiKey = data.key;
                    }
                })
                .catch(function() {})
                .then(function() {
                    if (!State.aiApiKey) {
                        reject(new Error('API Key未设置，请在程序设置→代理设置中配置'));
                        return;
                    }

            var systemPrompt = '你是单词PK答题助手。用户会给出题目和选项，你必须选出正确答案。你的回复只能是一个数字，表示正确选项的编号，不能包含任何其他文字、标点或解释。例如正确答案是第2个选项，你只回复2。';

            var userPrompt = '题目: ' + question + '\n';
            userPrompt += '选项:\n';
            for (var i = 0; i < candidates.length; i++) {
                userPrompt += (i + 1) + '. ' + candidates[i] + '\n';
            }
            userPrompt += '\n正确选项的编号是:';

            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, AI_TIMEOUT);

            fetch(AI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + State.aiApiKey
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0,
                    max_tokens: 5,
                    thinking: { type: 'disabled' }
                }),
                signal: controller.signal
            })
            .then(function(res) {
                clearTimeout(timeoutId);
                if (!res.ok) {
                    return res.text().then(function(t) {
                        throw new Error('HTTP ' + res.status + ': ' + t.substring(0, 200));
                    });
                }
                return res.json();
            })
            .then(function(data) {
                UI.addLogMessage('[AI兜底] API原始返回: ' + JSON.stringify(data).substring(0, 500), 'info');

                var content = '';
                if (data.choices && data.choices[0]) {
                    if (data.choices[0].message && data.choices[0].message.content) {
                        content = data.choices[0].message.content.trim();
                    } else if (typeof data.choices[0].text === 'string') {
                        content = data.choices[0].text.trim();
                    }
                }

                if (!content) {
                    reject(new Error('AI返回内容为空'));
                    return;
                }

                UI.addLogMessage('[AI兜底] AI回复内容: "' + content + '"', 'info');

                var match = content.match(/(\d+)/);
                if (match) {
                    var index = parseInt(match[1], 10) - 1;
                    if (index >= 0 && index < candidates.length) {
                        UI.addLogMessage('[AI兜底] 解析选项: [' + index + '] ' + candidates[index], 'info');
                        resolve(index);
                        return;
                    }
                }
                reject(new Error('AI返回格式异常: ' + content));
            })
            .catch(function(err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    reject(new Error('AI请求超时(' + AI_TIMEOUT + 'ms)'));
                } else {
                    reject(err);
                }
            });
        }); // close key-fetch .then()
        });
    }
};

var Loader = {
    detectType: function(entryList) {
        if (!Array.isArray(entryList) || entryList.length === 0) return 'full';
        var sampleSize = Math.min(10, entryList.length);
        for (var i = 0; i < sampleSize; i++) {
            if (entryList[i].newPropList && entryList[i].newPropList.length > 0)
                return 'full';
        }
        return 'simple';
    },

    fetchAiApiKey: function() {
        var bucketPort = localStorage.getItem('bucket-port') || '5290';
        var keyUrl = 'http://127.0.0.1:' + bucketPort + '/ai-api-key';
        fetch(keyUrl, { cache: 'no-cache' })
            .then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function(data) {
                if (data && typeof data.key === 'string') {
                    State.aiApiKey = data.key;
                    UI.addLogMessage('[AI兜底] API Key已从设置同步' + (data.key ? '' : ' (未设置)'), 'info');
                }
            })
            .catch(function(err) {
                UI.addLogMessage('[AI兜底] 从设置获取API Key失败: ' + err.message, 'warning');
            });
    },

    loadBucketFromServer: function() {
        Loader.fetchAiApiKey();
        try {
            var url = State.customBucketUrl || 'http://127.0.0.1:5290/word-pk-answer';
            UI.addLogMessage('[加载] 开始请求词库: ' + url, 'info');
            fetch(url, { cache: 'no-cache' })
                .then(function(res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.text();
                })
                .then(function(text) {
                    try {
                        var fullData = JSON.parse(text);
                        var entryList = [];
                        var dataSource = '';

                        if (fullData && fullData.version === '3.4' && fullData.index && fullData.words) {
                            State.jsonData = fullData;
                            State.currentBucketType = 'full';
                            State.totalWordsInBucket = State.jsonData.words.length;
                            ScoreControl.reset();
                            dataSource = 'v3.4 (预标准化)';
                            State.bucketLoaded = true;
                            State.bucketError = null;
                            State.bucketRetryCount = 0;
                            UI.updateStatus();
                            UI.addLogMessage('使用v3.4预标准化格式加载词库', 'info');
                            UI.addLogMessage('词库数据结构标准化完成 (v3.4)', 'success');
                            UI.addLogMessage('单词PK词库加载成功，共' + State.jsonData.words.length + '个词条，数据源：' + dataSource, 'success');
                            return;
                        }
                        else if (fullData && fullData.data && fullData.data.contentList && fullData.data.contentList[0] && fullData.data.contentList[0].entryList) {
                            entryList = fullData.data.contentList[0].entryList;
                            dataSource = '格式1 (contentList.entryList)';
                            UI.addLogMessage('使用格式1加载词库: contentList.entryList', 'info');
                        }
                        else if (fullData && Array.isArray(fullData.data) && fullData.data.length > 0 && fullData.data[0].entryList) {
                            // 合并所有词典的entryList
                            for (var di = 0; di < fullData.data.length; di++) {
                                if (fullData.data[di].entryList && Array.isArray(fullData.data[di].entryList)) {
                                    entryList = entryList.concat(fullData.data[di].entryList);
                                }
                            }
                            dataSource = '格式1.5 (data[*].entryList合并，共' + fullData.data.length + '本词典)';
                            UI.addLogMessage('使用格式1.5加载词库: 合并 ' + fullData.data.length + ' 本词典', 'info');
                        }
                        else if (fullData && fullData.data && fullData.data.words && Array.isArray(fullData.data.words)) {
                            entryList = fullData.data.words.map(function(wordItem) {
                                return {
                                    entry: wordItem.en,
                                    paraphrase: wordItem.cn,
                                    entryId: wordItem.entryId
                                };
                            });
                            dataSource = '格式2 (words)';
                            UI.addLogMessage('使用格式2加载词库: words (已转换字段名)', 'info');
                        }
                        else {
                            throw new Error('数据结构不正确，无法找到 entryList 或 words 数组');
                        }

                        if (entryList.length > 0) {
                            UI.addLogMessage('词库加载成功，共 ' + entryList.length + ' 个单词 (' + dataSource + ')', 'success');

                            State.currentBucketType = Loader.detectType(entryList);

                            if (State.currentBucketType === 'simple') {
                                State.jsonData = MatcherSimple.build(entryList);
                            } else {
                                State.jsonData = MatcherFull.build(entryList);
                            }

                            State.totalWordsInBucket = State.jsonData.words.length;
                            ScoreControl.reset();
                            State.bucketLoaded = true;
                            State.bucketError = null;
                            State.bucketRetryCount = 0;
                            UI.updateStatus();
                            UI.addLogMessage('词库数据结构标准化完成 (v3.4)', 'success');
                            UI.addLogMessage('单词PK词库加载成功，共' + State.jsonData.words.length + '个词条（含标准化），数据源：' + dataSource, 'success');
                        } else {
                            throw new Error('词库数据为空');
                        }
                    } catch (parseError) {
                        UI.addLogMessage('词库解析失败: ' + parseError.message, 'error');
                        throw new Error('词库数据解析失败: ' + parseError.message);
                    }
                })
                .catch(function(err) {
                    State.bucketLoaded = false;
                    State.bucketError = err.message || String(err);
                    UI.updateStatus();
                    UI.addLogMessage('词库加载失败: ' + err.message, 'error');
                    UI.addLogMessage('单词PK词库加载失败: ' + err.message, 'error');
                    State.bucketRetryCount++;
                    if (State.bucketRetryCount <= BUCKET_MAX_RETRIES) {
                        UI.addLogMessage('自动重试加载词库... (第' + State.bucketRetryCount + '/' + BUCKET_MAX_RETRIES + '次)', 'info');
                        setTimeout(function() {
                            Loader.loadBucketFromServer();
                        }, 1000);
                    } else {
                        UI.addLogMessage('词库加载已达最大重试次数(' + BUCKET_MAX_RETRIES + '次)，停止重试', 'error');
                    }
                });
        } catch (e) {
            State.bucketLoaded = false;
            State.bucketError = e.message || String(e);
            UI.updateStatus();
            UI.addLogMessage('词库加载异常: ' + e.message, 'error');
            UI.addLogMessage('单词PK词库加载异常: ' + e.message, 'error');
            State.bucketRetryCount++;
            if (State.bucketRetryCount <= BUCKET_MAX_RETRIES) {
                UI.addLogMessage('自动重试加载词库... (第' + State.bucketRetryCount + '/' + BUCKET_MAX_RETRIES + '次)', 'info');
                setTimeout(function() {
                    Loader.loadBucketFromServer();
                }, 1000);
            } else {
                UI.addLogMessage('词库加载已达最大重试次数(' + BUCKET_MAX_RETRIES + '次)，停止重试', 'error');
            }
        }
    }
};

var UI = {
    logMessages: [],
    autoPkPanel: null,
    logPanel: null,

    addLogMessage: function(message, type) {
        if (type === void 0) type = 'info';
        var timestamp = new Date().toLocaleTimeString();
        UI.logMessages.unshift({ timestamp: timestamp, message: message, type: type });
        if (UI.logMessages.length > 99999999) {
            UI.logMessages = UI.logMessages.slice(0, 99999999);
        }
        UI.updateLogPanel();
    },

    exportLogs: function() {
        if (UI.logMessages.length === 0) {
            UI.addLogMessage('没有日志可导出', 'warning');
            return;
        }

        var logText = UI.logMessages.slice().reverse().map(function(msg) {
            var typePrefix = '';
            if (msg.type === 'success') typePrefix = '[成功] ';
            if (msg.type === 'error') typePrefix = '[错误] ';
            if (msg.type === 'warning') typePrefix = '[警告] ';
            if (msg.type === 'match') typePrefix = '[匹配] ';
            return '[' + msg.timestamp + '] ' + typePrefix + msg.message;
        }).join('\n');

        UI.addLogMessage('正在保存日志到桌面...', 'info');

        fetch('http://127.0.0.1:5290/save-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: logText })
        })
        .then(function(res) { return res.json(); })
        .then(function(result) {
            if (result.success) {
                UI.addLogMessage('日志已保存到: ' + result.path, 'success');
            } else {
                UI.addLogMessage('保存失败: ' + result.error, 'error');
            }
        })
        .catch(function(err) {
            UI.addLogMessage('保存失败: ' + err.message, 'error');
        });
    },

    createLogPanel: function() {
        if (UI.logPanel) return;
        UI.logPanel = document.createElement('div');
        UI.logPanel.id = 'auto-pk-log-panel';
        UI.logPanel.style.position = 'fixed';
        UI.logPanel.style.right = '300px';
        UI.logPanel.style.bottom = '80px';
        UI.logPanel.style.width = '350px';
        UI.logPanel.style.height = '400px';
        UI.logPanel.style.background = 'rgba(0,0,0,0.9)';
        UI.logPanel.style.color = '#fff';
        UI.logPanel.style.borderRadius = '8px';
        UI.logPanel.style.padding = '10px';
        UI.logPanel.style.zIndex = '9998';
        UI.logPanel.style.overflow = 'hidden';
        UI.logPanel.style.display = 'none';
        UI.logPanel.style.userSelect = 'text';

        var header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';
        header.style.paddingBottom = '8px';
        header.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
        header.style.cursor = 'move';

        var titleSpan = document.createElement('span');
        titleSpan.textContent = '运行日志';
        titleSpan.style.fontSize = '14px';
        titleSpan.style.fontWeight = 'bold';
        header.appendChild(titleSpan);

        var exportBtn = document.createElement('button');
        exportBtn.textContent = '导出';
        exportBtn.title = '导出日志到桌面';
        exportBtn.style.fontSize = '12px';
        exportBtn.style.padding = '2px 6px';
        exportBtn.style.cursor = 'pointer';
        exportBtn.style.background = '#fff';
        exportBtn.style.border = 'none';
        exportBtn.style.color = '#000';
        exportBtn.style.borderRadius = '3px';
        exportBtn.style.marginRight = '3px';
        exportBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            UI.exportLogs();
        });
        header.appendChild(exportBtn);

        var closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00d7';
        closeBtn.style.fontSize = '18px';
        closeBtn.style.padding = '0 6px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.background = 'transparent';
        closeBtn.style.border = 'none';
        closeBtn.style.color = '#fff';
        closeBtn.style.userSelect = 'none';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            UI.logPanel.style.display = 'none';
        });
        header.appendChild(closeBtn);
        UI.logPanel.appendChild(header);

        var logViewport = document.createElement('div');
        logViewport.id = 'auto-pk-log-viewport';
        logViewport.style.height = 'calc(100% - 40px)';
        logViewport.style.overflowY = 'auto';
        logViewport.style.position = 'relative';
        logViewport.style.fontSize = '11px';
        logViewport.style.fontFamily = 'monospace';
        logViewport.style.userSelect = 'text';

        var logSpacer = document.createElement('div');
        logSpacer.id = 'auto-pk-log-spacer';

        var logVisible = document.createElement('div');
        logVisible.id = 'auto-pk-log-visible';
        logVisible.style.position = 'absolute';
        logVisible.style.top = '0';
        logVisible.style.left = '0';
        logVisible.style.right = '0';

        logViewport.appendChild(logSpacer);
        logViewport.appendChild(logVisible);
        UI.logPanel.appendChild(logViewport);

        logViewport.addEventListener('scroll', function() {
            UI.renderVisibleLogs();
        });

        document.body.appendChild(UI.logPanel);

        var isDragging = false;
        var offsetX = 0;
        var offsetY = 0;

        header.addEventListener('mousedown', function(e) {
            if (e.target === closeBtn) return;
            isDragging = true;
            offsetX = e.clientX - UI.logPanel.offsetLeft;
            offsetY = e.clientY - UI.logPanel.offsetTop;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            UI.logPanel.style.left = (e.clientX - offsetX) + 'px';
            UI.logPanel.style.top = (e.clientY - offsetY) + 'px';
            UI.logPanel.style.right = 'auto';
            UI.logPanel.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', function() {
            isDragging = false;
        });
    },

    updateLogPanel: function() {
        if (!UI.logPanel) return;
        var viewport = document.getElementById('auto-pk-log-viewport');
        if (!viewport) return;
        UI.renderVisibleLogs();
    },

    renderVisibleLogs: function() {
        var viewport = document.getElementById('auto-pk-log-viewport');
        if (!viewport) return;

        var spacer = document.getElementById('auto-pk-log-spacer');
        var visible = document.getElementById('auto-pk-log-visible');
        if (!spacer || !visible) return;

        var totalHeight = UI.logMessages.length * LOG_ROW_HEIGHT;
        spacer.style.height = totalHeight + 'px';

        var scrollTop = viewport.scrollTop;
        var viewportHeight = viewport.clientHeight;

        var startIndex = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - 2);
        var visibleCount = Math.ceil(viewportHeight / LOG_ROW_HEIGHT) + 20;
        var endIndex = Math.min(startIndex + visibleCount, UI.logMessages.length);

        visible.style.top = (startIndex * LOG_ROW_HEIGHT) + 'px';

        var html = '';
        for (var i = startIndex; i < endIndex; i++) {
            var msg = UI.logMessages[i];
            var color = '#fff';
            if (msg.type === 'success') color = '#4caf50';
            else if (msg.type === 'error') color = '#f44336';
            else if (msg.type === 'warning') color = '#ff9800';
            else if (msg.type === 'match') color = '#2196f3';

            var escapedMsg = msg.message
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            html += '<div style="margin-bottom:4px;color:' + color + '">[' + msg.timestamp + '] ' + escapedMsg + '</div>';
        }
        visible.innerHTML = html;
    },

    showSuccessMessage: function() {
        var messageDiv = document.createElement('div');
        messageDiv.style.position = 'fixed';
        messageDiv.style.top = '20px';
        messageDiv.style.left = '50%';
        messageDiv.style.transform = 'translateX(-50%)';
        messageDiv.style.padding = '15px 25px';
        messageDiv.style.backgroundColor = 'rgba(0, 200, 0, 0.9)';
        messageDiv.style.color = 'white';
        messageDiv.style.borderRadius = '5px';
        messageDiv.style.fontSize = '16px';
        messageDiv.style.fontWeight = 'bold';
        messageDiv.style.zIndex = '9999';
        messageDiv.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
        messageDiv.textContent = 'Auto366 注入成功，请点击控制面板的开始pk后点击页面中的开始PK按钮，并保持天学网在前台运行';
        document.body.appendChild(messageDiv);
        setTimeout(function() {
            messageDiv.style.transition = 'opacity 0.5s';
            messageDiv.style.opacity = '0';
            setTimeout(function() {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 500);
        }, 15000);
    },

    createAutoPkPanel: function() {
        if (UI.autoPkPanel) return;
        UI.autoPkPanel = document.createElement('div');
        UI.autoPkPanel.style.position = 'fixed';
        UI.autoPkPanel.style.right = '20px';
        UI.autoPkPanel.style.bottom = '80px';
        UI.autoPkPanel.style.width = '280px';
        UI.autoPkPanel.style.background = 'rgba(0,0,0,0.8)';
        UI.autoPkPanel.style.color = '#fff';
        UI.autoPkPanel.style.borderRadius = '8px';
        UI.autoPkPanel.style.padding = '10px';
        UI.autoPkPanel.style.zIndex = '9999';
        UI.autoPkPanel.style.cursor = 'move';

        var header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';

        var titleSpan = document.createElement('span');
        titleSpan.textContent = '单词PK自动化';
        titleSpan.style.fontSize = '14px';
        titleSpan.style.fontWeight = 'bold';
        header.appendChild(titleSpan);

        var settingsBtn = document.createElement('button');
        settingsBtn.textContent = '\u2699';
        settingsBtn.title = '设置词库位置';
        settingsBtn.style.fontSize = '14px';
        settingsBtn.style.padding = '2px 6px';
        settingsBtn.style.cursor = 'pointer';
        settingsBtn.style.background = 'rgba(255,255,255,0.2)';
        settingsBtn.style.border = 'none';
        settingsBtn.style.color = '#fff';
        settingsBtn.style.borderRadius = '3px';
        settingsBtn.style.marginRight = '4px';
        settingsBtn.addEventListener('click', function(e) {
            e.stopPropagation();

            var dialog = document.createElement('div');
            dialog.style.position = 'fixed';
            dialog.style.left = '50%';
            dialog.style.top = '50%';
            dialog.style.transform = 'translate(-50%, -50%)';
            dialog.style.background = 'rgba(0,0,0,0.9)';
            dialog.style.color = '#fff';
            dialog.style.padding = '20px';
            dialog.style.borderRadius = '8px';
            dialog.style.zIndex = '10000';
            dialog.style.minWidth = '300px';
            dialog.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

            var title = document.createElement('h3');
            title.textContent = '设置自定义词库URL';
            title.style.marginTop = '0';
            title.style.marginBottom = '15px';
            dialog.appendChild(title);

            var input = document.createElement('input');
            input.type = 'text';
            input.value = State.customBucketUrl;
            input.style.width = '100%';
            input.style.padding = '8px';
            input.style.marginBottom = '15px';
            input.style.boxSizing = 'border-box';
            input.style.borderRadius = '4px';
            input.style.border = '1px solid rgba(255,255,255,0.3)';
            input.style.background = 'rgba(255,255,255,0.1)';
            input.style.color = '#fff';
            dialog.appendChild(input);

            var btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.justifyContent = 'flex-end';
            btnContainer.style.gap = '10px';

            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.padding = '8px 16px';
            cancelBtn.style.borderRadius = '4px';
            cancelBtn.style.border = 'none';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.style.background = 'rgba(255,255,255,0.2)';
            cancelBtn.style.color = '#fff';

            var confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确定';
            confirmBtn.style.padding = '8px 16px';
            confirmBtn.style.borderRadius = '4px';
            confirmBtn.style.border = 'none';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.style.background = '#4caf50';
            confirmBtn.style.color = '#fff';

            btnContainer.appendChild(cancelBtn);
            btnContainer.appendChild(confirmBtn);
            dialog.appendChild(btnContainer);

            document.body.appendChild(dialog);

            setTimeout(function() { input.focus(); }, 100);

            function closeDialog() {
                if (dialog.parentNode) {
                    dialog.parentNode.removeChild(dialog);
                }
            }

            cancelBtn.addEventListener('click', closeDialog);

            confirmBtn.addEventListener('click', function() {
                var newUrl = input.value.trim();
                State.customBucketUrl = newUrl;
                localStorage.setItem('customBucketUrl', State.customBucketUrl);
                State.bucketLoaded = false;
                State.bucketError = null;
                State.bucketRetryCount = 0;
                UI.updateStatus();
                UI.addLogMessage('词库URL已更新: ' + (State.customBucketUrl || '使用默认URL'), 'info');
                Loader.loadBucketFromServer();
                closeDialog();
            });

            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                }
            });
        });
        header.appendChild(settingsBtn);

        var logBtn = document.createElement('button');
        logBtn.textContent = 'Logs';
        logBtn.title = '查看日志';
        logBtn.style.fontSize = '12px';
        logBtn.style.padding = '2px 6px';
        logBtn.style.cursor = 'pointer';
        logBtn.style.background = 'rgba(255,255,255,0.2)';
        logBtn.style.border = 'none';
        logBtn.style.color = '#fff';
        logBtn.style.borderRadius = '3px';
        logBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!UI.logPanel) {
                UI.createLogPanel();
            }
            UI.logPanel.style.display = UI.logPanel.style.display === 'none' ? 'block' : 'none';
        });
        header.appendChild(logBtn);

        var consoleBtn = document.createElement('button');
        consoleBtn.textContent = 'Console';
        consoleBtn.title = '打开内部控制台';
        consoleBtn.style.fontSize = '12px';
        consoleBtn.style.padding = '2px 6px';
        consoleBtn.style.cursor = 'pointer';
        consoleBtn.style.background = 'rgba(0,122,204,0.8)';
        consoleBtn.style.border = 'none';
        consoleBtn.style.color = '#fff';
        consoleBtn.style.borderRadius = '3px';
        consoleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (typeof openDevConsole === 'function') {
                openDevConsole();
                UI.addLogMessage('已打开内部控制台', 'info');
            } else {
                UI.addLogMessage('内部控制台未加载', 'error');
            }
        });
        header.appendChild(consoleBtn);
        UI.autoPkPanel.appendChild(header);

        var delayRow = document.createElement('div');
        delayRow.style.display = 'flex';
        delayRow.style.alignItems = 'center';
        delayRow.style.marginBottom = '6px';
        var delayLabel = document.createElement('span');
        delayLabel.textContent = '间隔(ms)：';
        delayLabel.style.fontSize = '12px';
        var delayInput = document.createElement('input');
        delayInput.type = 'number';
        delayInput.value = String(State.autoPkDelay);
        delayInput.style.flex = '1';
        delayInput.style.marginLeft = '6px';
        delayInput.style.fontSize = '12px';
        delayInput.style.background = 'rgba(255,255,255,0.2)';
        delayInput.style.color = '#fff';
        delayInput.style.border = '1px solid rgba(255,255,255,0.3)';
        delayInput.style.borderRadius = '3px';
        delayInput.addEventListener('change', function() {
            var v = parseInt(delayInput.value, 10);
            if (Number.isFinite(v) && v > 0) {
                State.autoPkDelay = v;
                if (State.autoPkIntervalId) {
                    Scheduler.start();
                }
            }
        });
        delayRow.appendChild(delayLabel);
        delayRow.appendChild(delayInput);
        UI.autoPkPanel.appendChild(delayRow);

        var presetRow = document.createElement('div');
        presetRow.style.display = 'flex';
        presetRow.style.gap = '4px';
        presetRow.style.marginBottom = '6px';

        var preset1 = document.createElement('button');
        preset1.textContent = '10ms';
        preset1.title = '速度最快';
        preset1.style.flex = '1';
        preset1.style.fontSize = '11px';
        preset1.style.padding = '4px';
        preset1.style.background = 'rgba(255,255,255,0.25)';
        preset1.style.color = '#fff';
        preset1.style.border = '1px solid rgba(255,255,255,0.3)';
        preset1.style.borderRadius = '3px';
        preset1.addEventListener('click', function() {
            State.autoPkDelay = 10;
            delayInput.value = '10';
            if (State.autoPkIntervalId) {
                Scheduler.start();
            }
        });

        var preset2 = document.createElement('button');
        preset2.textContent = '500ms';
        preset2.title = '均衡';
        preset2.style.flex = '1';
        preset2.style.fontSize = '11px';
        preset2.style.padding = '4px';
        preset2.style.background = 'rgba(255,255,255,0.25)';
        preset2.style.color = '#fff';
        preset2.style.border = '1px solid rgba(255,255,255,0.3)';
        preset2.style.borderRadius = '3px';
        preset2.addEventListener('click', function() {
            State.autoPkDelay = 500;
            delayInput.value = '500';
            if (State.autoPkIntervalId) {
                Scheduler.start();
            }
        });

        var preset3 = document.createElement('button');
        preset3.textContent = '2000ms';
        preset3.title = '准确率最高';
        preset3.style.flex = '1';
        preset3.style.fontSize = '11px';
        preset3.style.padding = '4px';
        preset3.style.background = 'rgba(255,255,255,0.25)';
        preset3.style.color = '#fff';
        preset3.style.border = '1px solid rgba(255,255,255,0.3)';
        preset3.style.borderRadius = '3px';
        preset3.addEventListener('click', function() {
            State.autoPkDelay = 2000;
            delayInput.value = '2000';
            if (State.autoPkIntervalId) {
                Scheduler.start();
            }
        });

        presetRow.appendChild(preset1);
        presetRow.appendChild(preset2);
        presetRow.appendChild(preset3);
        UI.autoPkPanel.appendChild(presetRow);

        var scDivider = document.createElement('div');
        scDivider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
        scDivider.style.margin = '8px 0 4px 0';
        scDivider.style.paddingTop = '6px';
        scDivider.style.fontSize = '14px';
        scDivider.style.fontWeight = 'bold';
        scDivider.style.color = '#fff';
        scDivider.textContent = '分数控制';
        UI.autoPkPanel.appendChild(scDivider);

        var scEnableRow = document.createElement('div');
        scEnableRow.style.display = 'flex';
        scEnableRow.style.alignItems = 'center';
        scEnableRow.style.marginBottom = '4px';
        var scCheckbox = document.createElement('input');
        scCheckbox.type = 'checkbox';
        scCheckbox.checked = State.scoreControlEnabled;
        scCheckbox.style.marginRight = '6px';
        scCheckbox.style.cursor = 'pointer';
        scCheckbox.addEventListener('change', function() {
            State.scoreControlEnabled = scCheckbox.checked;
            localStorage.setItem('scoreControlEnabled', String(State.scoreControlEnabled));
            if (!State.scoreControlEnabled) {
                ScoreControl.reset();
            }
            UI.updateStatus();
            UI.addLogMessage('[分数控制] ' + (State.scoreControlEnabled ? '已启用' : '已禁用'), 'info');
        });
        var scEnableLabel = document.createElement('span');
        scEnableLabel.textContent = '启用';
        scEnableLabel.style.fontSize = '12px';
        scEnableRow.appendChild(scCheckbox);
        scEnableRow.appendChild(scEnableLabel);

        var scModeRate = document.createElement('button');
        scModeRate.textContent = '得分率';
        scModeRate.style.fontSize = '11px';
        scModeRate.style.padding = '2px 6px';
        scModeRate.style.marginLeft = '8px';
        scModeRate.style.cursor = 'pointer';
        scModeRate.style.borderRadius = '3px';
        scModeRate.style.border = 'none';
        var scModeCount = document.createElement('button');
        scModeCount.textContent = '正确题数';
        scModeCount.style.fontSize = '11px';
        scModeCount.style.padding = '2px 6px';
        scModeCount.style.marginLeft = '4px';
        scModeCount.style.cursor = 'pointer';
        scModeCount.style.borderRadius = '3px';
        scModeCount.style.border = 'none';

        function updateModeButtons() {
            if (State.scoreControlMode === 'rate') {
                scModeRate.style.background = '#4caf50';
                scModeRate.style.color = '#fff';
                scModeCount.style.background = 'rgba(255,255,255,0.2)';
                scModeCount.style.color = '#fff';
                scRateRow.style.display = 'flex';
                scCountRow.style.display = 'none';
            } else {
                scModeRate.style.background = 'rgba(255,255,255,0.2)';
                scModeRate.style.color = '#fff';
                scModeCount.style.background = '#4caf50';
                scModeCount.style.color = '#fff';
                scRateRow.style.display = 'none';
                scCountRow.style.display = 'flex';
            }
        }

        scModeRate.addEventListener('click', function() {
            State.scoreControlMode = 'rate';
            localStorage.setItem('scoreControlMode', 'rate');
            ScoreControl.reset();
            updateModeButtons();
            UI.updateStatus();
            UI.addLogMessage('[分数控制] 切换为得分率模式', 'info');
        });
        scModeCount.addEventListener('click', function() {
            State.scoreControlMode = 'count';
            localStorage.setItem('scoreControlMode', 'count');
            ScoreControl.reset();
            updateModeButtons();
            UI.updateStatus();
            UI.addLogMessage('[分数控制] 切换为正确题数模式', 'info');
        });

        scEnableRow.appendChild(scModeRate);
        scEnableRow.appendChild(scModeCount);
        UI.autoPkPanel.appendChild(scEnableRow);

        var scRateRow = document.createElement('div');
        scRateRow.style.display = 'flex';
        scRateRow.style.alignItems = 'center';
        scRateRow.style.marginBottom = '4px';
        var scRateLabel = document.createElement('span');
        scRateLabel.textContent = '得分率:';
        scRateLabel.style.fontSize = '12px';
        scRateLabel.style.marginRight = '4px';
        scRateRow.appendChild(scRateLabel);
        var scRateInput = document.createElement('input');
        scRateInput.type = 'number';
        scRateInput.min = '0';
        scRateInput.max = '100';
        scRateInput.value = String(State.targetScoreRate);
        scRateInput.style.width = '45px';
        scRateInput.style.fontSize = '12px';
        scRateInput.style.textAlign = 'center';
        scRateInput.style.background = 'rgba(255,255,255,0.2)';
        scRateInput.style.color = '#fff';
        scRateInput.style.border = '1px solid rgba(255,255,255,0.3)';
        scRateInput.style.borderRadius = '3px';
        scRateInput.addEventListener('change', function() {
            var v = parseInt(scRateInput.value, 10);
            if (Number.isFinite(v) && v >= 0 && v <= 100) {
                State.targetScoreRate = v;
                localStorage.setItem('targetScoreRate', String(v));
                ScoreControl.reset();
                UI.updateStatus();
                UI.addLogMessage('[分数控制] 得分率设为 ' + v + '%', 'info');
            }
        });
        scRateRow.appendChild(scRateInput);
        var scRateSuffix = document.createElement('span');
        scRateSuffix.textContent = '%';
        scRateSuffix.style.fontSize = '12px';
        scRateSuffix.style.marginLeft = '2px';
        scRateRow.appendChild(scRateSuffix);
        UI.autoPkPanel.appendChild(scRateRow);

        var scCountRow = document.createElement('div');
        scCountRow.style.display = 'flex';
        scCountRow.style.alignItems = 'center';
        scCountRow.style.marginBottom = '4px';
        var scCountLabel = document.createElement('span');
        scCountLabel.textContent = '正确题数:';
        scCountLabel.style.fontSize = '12px';
        scCountLabel.style.marginRight = '4px';
        scCountRow.appendChild(scCountLabel);
        var scCountInput = document.createElement('input');
        scCountInput.type = 'number';
        scCountInput.min = '0';
        scCountInput.value = String(State.targetCorrectCount || '');
        scCountInput.style.width = '50px';
        scCountInput.style.fontSize = '12px';
        scCountInput.style.textAlign = 'center';
        scCountInput.addEventListener('change', function() {
            var v = parseInt(scCountInput.value, 10);
            if (Number.isFinite(v) && v >= 0) {
                State.targetCorrectCount = v;
                localStorage.setItem('targetCorrectCount', String(v));
                ScoreControl.reset();
                UI.updateStatus();
                UI.addLogMessage('[分数控制] 正确题数设为 ' + v, 'info');
            }
        });
        scCountRow.appendChild(scCountInput);
        var scCountSuffix = document.createElement('span');
        scCountSuffix.textContent = '题';
        scCountSuffix.style.fontSize = '12px';
        scCountSuffix.style.marginLeft = '2px';
        scCountRow.appendChild(scCountSuffix);
        UI.autoPkPanel.appendChild(scCountRow);

        updateModeButtons();

        var scProgressRow = document.createElement('div');
        scProgressRow.style.fontSize = '11px';
        scProgressRow.style.marginBottom = '6px';
        scProgressRow.style.color = '#aaa';
        scProgressRow.id = 'auto-pk-score-progress';
        UI.autoPkPanel.appendChild(scProgressRow);

        var aiDivider = document.createElement('div');
        aiDivider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
        aiDivider.style.margin = '8px 0 4px 0';
        aiDivider.style.paddingTop = '6px';
        aiDivider.style.fontSize = '14px';
        aiDivider.style.fontWeight = 'bold';
        aiDivider.style.color = '#fff';
        aiDivider.textContent = 'AI兜底';
        UI.autoPkPanel.appendChild(aiDivider);

        var aiEnableRow = document.createElement('div');
        aiEnableRow.style.display = 'flex';
        aiEnableRow.style.alignItems = 'center';
        aiEnableRow.style.marginBottom = '4px';
        var aiCheckbox = document.createElement('input');
        aiCheckbox.type = 'checkbox';
        aiCheckbox.checked = State.aiEnabled;
        aiCheckbox.style.marginRight = '6px';
        aiCheckbox.style.cursor = 'pointer';
        aiCheckbox.addEventListener('change', function() {
            State.aiEnabled = aiCheckbox.checked;
            localStorage.setItem('aiEnabled', String(State.aiEnabled));
            UI.updateStatus();
            UI.addLogMessage('[AI兜底] ' + (State.aiEnabled ? '已启用' : '已禁用'), 'info');
        });
        var aiEnableLabel = document.createElement('span');
        aiEnableLabel.textContent = '启用';
        aiEnableLabel.style.fontSize = '12px';
        aiEnableLabel.style.marginRight = '8px';
        aiEnableRow.appendChild(aiCheckbox);
        aiEnableRow.appendChild(aiEnableLabel);

        var aiThreshLabel = document.createElement('span');
        aiThreshLabel.textContent = '阈值:';
        aiThreshLabel.style.fontSize = '12px';
        aiThreshLabel.style.marginRight = '4px';
        aiEnableRow.appendChild(aiThreshLabel);
        var aiThreshInput = document.createElement('input');
        aiThreshInput.type = 'number';
        aiThreshInput.min = '0';
        aiThreshInput.max = '100';
        aiThreshInput.value = String(State.aiThreshold);
        aiThreshInput.style.width = '45px';
        aiThreshInput.style.fontSize = '12px';
        aiThreshInput.style.textAlign = 'center';
        aiThreshInput.style.background = 'rgba(255,255,255,0.2)';
        aiThreshInput.style.color = '#fff';
        aiThreshInput.style.border = '1px solid rgba(255,255,255,0.3)';
        aiThreshInput.style.borderRadius = '3px';
        aiThreshInput.addEventListener('change', function() {
            var v = parseInt(aiThreshInput.value, 10);
            if (Number.isFinite(v) && v >= 0 && v <= 100) {
                State.aiThreshold = v;
                localStorage.setItem('aiThreshold', String(v));
                UI.updateStatus();
                UI.addLogMessage('[AI兜底] 阈值设为 ' + v + '% (置信度低于此值时调用AI)', 'info');
            }
        });
        aiEnableRow.appendChild(aiThreshInput);
        var aiThreshSuffix = document.createElement('span');
        aiThreshSuffix.textContent = '%';
        aiThreshSuffix.style.fontSize = '12px';
        aiThreshSuffix.style.marginLeft = '2px';
        aiEnableRow.appendChild(aiThreshSuffix);
        UI.autoPkPanel.appendChild(aiEnableRow);

        // ===== 时间修改修改（通用自动PK 的子规则）=====
        var ptDivider = document.createElement('div');
        ptDivider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
        ptDivider.style.margin = '8px 0 4px 0';
        ptDivider.style.paddingTop = '6px';
        ptDivider.style.fontSize = '14px';
        ptDivider.style.fontWeight = 'bold';
        ptDivider.style.color = '#fff';
        ptDivider.textContent = '时间修改';
        UI.autoPkPanel.appendChild(ptDivider);

        var ptRow = document.createElement('div');
        ptRow.style.display = 'flex';
        ptRow.style.alignItems = 'center';
        ptRow.style.marginBottom = '4px';

        var ptCheckbox = document.createElement('input');
        ptCheckbox.type = 'checkbox';
        ptCheckbox.checked = State.pkTimeModEnabled;
        ptCheckbox.style.marginRight = '6px';
        ptCheckbox.style.cursor = 'pointer';

        // 分 + 秒 两个输入框（总秒数 = 分×60 + 秒，存入 State.pkTimeModSeconds）
        function ptMakeNumInput() {
            var el = document.createElement('input');
            el.type = 'number';
            el.step = '1';
            el.min = String(INT32_MIN);
            el.max = String(INT32_MAX);
            el.placeholder = '-';
            el.style.width = '52px';
            el.style.fontSize = '12px';
            el.style.textAlign = 'center';
            el.style.background = 'rgba(255,255,255,0.2)';
            el.style.color = '#fff';
            el.style.border = '1px solid rgba(255,255,255,0.3)';
            el.style.borderRadius = '3px';
            el.disabled = !State.pkTimeModEnabled;
            el.style.opacity = State.pkTimeModEnabled ? '1' : '0.5';
            return el;
        }
        var ptMinInput = ptMakeNumInput();
        var ptSecInput = ptMakeNumInput();

        // 用总秒数回填分秒框（保留符号：负总秒显示为 -分/-秒里的分钟带号）
        function ptFillFromTotal() {
            if (State.pkTimeModSeconds === null || State.pkTimeModSeconds === undefined) {
                ptMinInput.value = '';
                ptSecInput.value = '';
                return;
            }
            var total = State.pkTimeModSeconds;
            var sign = total < 0 ? -1 : 1;
            var abs = Math.abs(total);
            var mins = Math.floor(abs / 60) * sign;
            var secs = (abs % 60) * sign;
            ptMinInput.value = String(mins);
            ptSecInput.value = String(secs);
        }
        ptFillFromTotal();

        // 从分秒框读出总秒数并写入 State + 同步
        function ptCommitFromInputs() {
            var mRaw = ptMinInput.value.trim();
            var sRaw = ptSecInput.value.trim();
            if (mRaw === '' && sRaw === '') {
                State.pkTimeModSeconds = null;
                localStorage.removeItem('pkTimeModSeconds');
                UI.addLogMessage('[时间修改] 时间已清空（提交不会被修改）', 'info');
                PkTimeMod.push();
                return;
            }
            var m = mRaw === '' ? 0 : parseInt(mRaw, 10);
            var s = sRaw === '' ? 0 : parseInt(sRaw, 10);
            if (!Number.isFinite(m)) m = 0;
            if (!Number.isFinite(s)) s = 0;
            var total = m * 60 + s;
            if (total < INT32_MIN) total = INT32_MIN;
            if (total > INT32_MAX) total = INT32_MAX;
            State.pkTimeModSeconds = total;
            localStorage.setItem('pkTimeModSeconds', String(total));
            ptFillFromTotal();
            UI.addLogMessage('[时间修改] 提交用时设为 ' + m + '分' + s + '秒 = ' + total + '秒（duration=' + (total * 1000) + 'ms）', 'info');
            PkTimeMod.push();
        }

        ptCheckbox.addEventListener('change', function() {
            State.pkTimeModEnabled = ptCheckbox.checked;
            localStorage.setItem('pkTimeModEnabled', String(State.pkTimeModEnabled));
            ptMinInput.disabled = !State.pkTimeModEnabled;
            ptSecInput.disabled = !State.pkTimeModEnabled;
            ptMinInput.style.opacity = State.pkTimeModEnabled ? '1' : '0.5';
            ptSecInput.style.opacity = State.pkTimeModEnabled ? '1' : '0.5';
            UI.addLogMessage('[时间修改] ' + (State.pkTimeModEnabled ? '已启用' : '已禁用')
                + (State.pkTimeModEnabled && State.pkTimeModSeconds === null ? '（时间未填，提交不会被修改）' : ''), 'info');
            PkTimeMod.push();
        });
        ptMinInput.addEventListener('change', ptCommitFromInputs);
        ptSecInput.addEventListener('change', ptCommitFromInputs);

        var ptEnableLabel = document.createElement('span');
        ptEnableLabel.textContent = '启用';
        ptEnableLabel.style.fontSize = '12px';
        ptEnableLabel.style.marginRight = '8px';

        var ptMinSuffix = document.createElement('span');
        ptMinSuffix.textContent = '分';
        ptMinSuffix.style.fontSize = '12px';
        ptMinSuffix.style.margin = '0 4px 0 2px';

        var ptSecSuffix = document.createElement('span');
        ptSecSuffix.textContent = '秒';
        ptSecSuffix.style.fontSize = '12px';
        ptSecSuffix.style.marginLeft = '2px';

        ptRow.appendChild(ptCheckbox);
        ptRow.appendChild(ptEnableLabel);
        ptRow.appendChild(ptMinInput);
        ptRow.appendChild(ptMinSuffix);
        ptRow.appendChild(ptSecInput);
        ptRow.appendChild(ptSecSuffix);
        UI.autoPkPanel.appendChild(ptRow);

        var statsRow = document.createElement('div');
        statsRow.style.fontSize = '11px';
        statsRow.style.marginBottom = '6px';
        statsRow.style.color = '#aaa';
        statsRow.id = 'auto-pk-stats';
        UI.autoPkPanel.appendChild(statsRow);

        var statusRow = document.createElement('div');
        statusRow.style.fontSize = '12px';
        statusRow.style.marginBottom = '6px';
        statusRow.id = 'auto-pk-status';
        UI.autoPkPanel.appendChild(statusRow);

        var btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '6px';

        var toggleBtn = document.createElement('button');
        toggleBtn.id = 'auto-pk-toggle';
        toggleBtn.textContent = '开始PK';
        toggleBtn.style.flex = '1';
        toggleBtn.style.fontSize = '12px';
        toggleBtn.style.background = 'rgba(255,255,255,0.2)';
        toggleBtn.style.color = '#fff';
        toggleBtn.style.border = '1px solid rgba(255,255,255,0.3)';
        toggleBtn.style.borderRadius = '3px';
        toggleBtn.addEventListener('click', function() {
            if (State.autoPkIntervalId) {
                Scheduler.stop();
            } else {
                Scheduler.start();
            }
        });

        var reloadBtn = document.createElement('button');
        reloadBtn.textContent = '重载词库';
        reloadBtn.style.flex = '1';
        reloadBtn.style.fontSize = '12px';
        reloadBtn.style.background = 'rgba(255,255,255,0.2)';
        reloadBtn.style.color = '#fff';
        reloadBtn.style.border = '1px solid rgba(255,255,255,0.3)';
        reloadBtn.style.borderRadius = '3px';
        reloadBtn.addEventListener('click', function() {
            State.bucketLoaded = false;
            State.bucketError = null;
            State.bucketRetryCount = 0;
            State.lastMatchedWord = '';
            State.matchCount = 0;
            State.missCount = 0;
            ScoreControl.reset();
            UI.updateStatus();
            Loader.loadBucketFromServer();
        });

        btnRow.appendChild(toggleBtn);
        btnRow.appendChild(reloadBtn);
        UI.autoPkPanel.appendChild(btnRow);

        document.body.appendChild(UI.autoPkPanel);

        var isDragging = false;
        var offsetX = 0;
        var offsetY = 0;
        UI.autoPkPanel.addEventListener('mousedown', function(e) {
            isDragging = true;
            offsetX = e.clientX - UI.autoPkPanel.offsetLeft;
            offsetY = e.clientY - UI.autoPkPanel.offsetTop;
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            UI.autoPkPanel.style.left = (e.clientX - offsetX) + 'px';
            UI.autoPkPanel.style.top = (e.clientY - offsetY) + 'px';
            UI.autoPkPanel.style.right = 'auto';
            UI.autoPkPanel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function() {
            isDragging = false;
        });

        UI.updateStatus();
    },

    updateStatus: function() {
        if (!UI.autoPkPanel) return;
        var statusEl = document.getElementById('auto-pk-status');
        var toggleBtn = document.getElementById('auto-pk-toggle');
        var statsEl = document.getElementById('auto-pk-stats');
        var scoreProgressEl = document.getElementById('auto-pk-score-progress');
        if (statusEl) {
            if (State.bucketLoaded) {
                statusEl.textContent = '词库加载成功';
                statusEl.style.color = '#4caf50';
            } else if (State.bucketError) {
                statusEl.textContent = '词库加载失败: ' + State.bucketError;
                statusEl.style.color = '#ff9800';
            } else {
                statusEl.textContent = '词库加载中...';
                statusEl.style.color = '#ffc107';
            }
        }
        if (toggleBtn) {
            toggleBtn.textContent = State.autoPkIntervalId ? '停止PK' : '开始PK';
        }
        if (statsEl) {
            var rate = State.matchCount + State.missCount > 0 ? Math.round(State.matchCount / (State.matchCount + State.missCount) * 100) : 0;
            statsEl.textContent = '命中: ' + State.matchCount + ' | 未命中: ' + State.missCount + ' | 命中率: ' + rate + '%';
        }
        if (scoreProgressEl) {
            if (State.scoreControlEnabled) {
                scoreProgressEl.textContent = ScoreControl.getProgressText();
                scoreProgressEl.style.color = State.scoreControlActive ? '#ff9800' : '#aaa';
            } else {
                scoreProgressEl.textContent = '';
            }
        }
    }
};

var Scheduler = {
    auto: function() {
        if (State.aiWaiting) return;

        var cnElements = document.getElementsByClassName('u3-pk-core__cn');
        if (!cnElements || cnElements.length === 0) {
            UI.addLogMessage('[DOM] 未找到题目元素(.u3-pk-core__cn)', 'warning');
            return;
        }
        var textElements = document.getElementsByClassName('u3-pk-core__text');
        if (!textElements || textElements.length === 0) {
            UI.addLogMessage('[DOM] 未找到选项元素(.u3-pk-core__text)', 'warning');
            return;
        }

        var word = cnElements[0].innerHTML;
        var l = [];
        Array.from(textElements).forEach(function(e) { l.push(e.innerHTML); });

        if (word === State.lastMatchedWord) {
            return;
        }

        UI.addLogMessage('[DOM] 读取题目innerHTML="' + word + '" | 选项数=' + l.length + ' | 选项=' + JSON.stringify(l), 'info');

        if (State.scoreControlEnabled && ScoreControl.shouldIntentionallyMiss()) {
            var missResult;
            if (State.currentBucketType === 'simple') {
                missResult = MatcherSimple.match(word, l);
            } else {
                missResult = MatcherFull.match(word, l);
            }
            var worstIndex = ScoreControl.findWorstCandidateIndex();
            State.lastMatchedWord = word;
            ScoreControl.recordAnswer(0);
            UI.addLogMessage('[分数控制] 故意选错: [' + worstIndex + '] ' + l[worstIndex] + ' (最低匹配度)', 'warning');
            textElements[worstIndex].click();
            textElements[worstIndex].parentNode.click();
            textElements[worstIndex].parentNode.parentNode.click();
            UI.updateStatus();
            return;
        }

        var result;
        if (State.currentBucketType === 'simple') {
            result = MatcherSimple.match(word, l);
        } else {
            result = MatcherFull.match(word, l);
        }

        var bestScore = 0;
        if (State.lastMatchScores && State.lastMatchScores.length > 0) {
            for (var i = 0; i < State.lastMatchScores.length; i++) {
                if (State.lastMatchScores[i].score > bestScore) {
                    bestScore = State.lastMatchScores[i].score;
                }
            }
        }

        if (State.aiEnabled && State.aiApiKey && bestScore < State.aiThreshold) {
            State.aiWaiting = true;
            State.lastMatchedWord = word;
            UI.addLogMessage('[AI兜底] 算法置信度=' + Math.round(bestScore) + '% < 阈值=' + State.aiThreshold + '%，调用AI (' + AI_MODEL + ')...', 'info');

            var savedWord = word;
            var savedCandidates = l;
            var savedResult = result;
            var savedTextElements = textElements;

            AIFallback.query(savedWord, savedCandidates).then(function(aiIndex) {
                var currentCn = document.getElementsByClassName('u3-pk-core__cn');
                if (currentCn && currentCn.length > 0 && currentCn[0].innerHTML === savedWord) {
                    ScoreControl.recordAnswer(100);
                    UI.addLogMessage('[AI兜底] AI选择: [' + aiIndex + '] ' + savedCandidates[aiIndex], 'match');
                    savedTextElements[aiIndex].click();
                    savedTextElements[aiIndex].parentNode.click();
                    savedTextElements[aiIndex].parentNode.parentNode.click();
                } else {
                    UI.addLogMessage('[AI兜底] 题目已变化，放弃AI结果', 'warning');
                }
                State.aiWaiting = false;
                UI.updateStatus();
            }).catch(function(err) {
                UI.addLogMessage('[AI兜底] AI调用失败: ' + err.message + '，使用算法结果', 'warning');
                var currentCn2 = document.getElementsByClassName('u3-pk-core__cn');
                if (currentCn2 && currentCn2.length > 0 && currentCn2[0].innerHTML === savedWord) {
                    ScoreControl.recordAnswer(bestScore);
                    savedTextElements[savedResult].click();
                    savedTextElements[savedResult].parentNode.click();
                    savedTextElements[savedResult].parentNode.parentNode.click();
                }
                State.aiWaiting = false;
                UI.updateStatus();
            });
            return;
        }

        State.lastMatchedWord = word;
        ScoreControl.recordAnswer(bestScore);
        UI.addLogMessage('[点击] 点击候选[' + result + ']: "' + l[result] + '"', 'info');
        textElements[result].click();
        textElements[result].parentNode.click();
        textElements[result].parentNode.parentNode.click();
        UI.updateStatus();
    },

    start: function() {
        if (State.autoPkIntervalId) {
            clearInterval(State.autoPkIntervalId);
            State.autoPkIntervalId = null;
        }
        State.autoPkIntervalId = setInterval(Scheduler.auto, State.autoPkDelay);
        UI.updateStatus();
        UI.addLogMessage('[控制] 自动PK已启动，间隔=' + State.autoPkDelay + 'ms', 'info');
    },

    stop: function() {
        if (State.autoPkIntervalId) {
            clearInterval(State.autoPkIntervalId);
            State.autoPkIntervalId = null;
        }
        UI.updateStatus();
        UI.addLogMessage('[控制] 自动PK已停止 | 统计: 命中=' + State.matchCount + ' 未命中=' + State.missCount + ' 命中率=' + (State.matchCount + State.missCount > 0 ? Math.round(State.matchCount / (State.matchCount + State.missCount) * 100) : 0) + '%', 'info');
    }
};

// ============================================================
// 时间修改修改 —— 网络层 Hook（fetch + XHR）
// 本规则集靠 DOM 点击答题，原本不碰 submit 请求；这里新增 hook，
// 拦截两类提交并改写 submitJson.duration（毫秒）+ wordInfos[].answerTime。
//   普通PK : .../wordsbtl/student/submit
//   词王争霸: .../word-king/submit
// duration 单位为毫秒：用户填的是“秒”，落库时 ×1000。
// ============================================================
var PkTimeMod = {
    // 改包逻辑已移到代理层(modules/proxy.js)，因为 submit 是 Electron 客户端的
    // 网络请求，不经过本注入页的 fetch/XHR——页面层 hook 永远拦不到。
    // 这里只负责把"启用/秒数"状态经本地 bucket server 推给代理层。
    bucketBase: function() {
        var port = localStorage.getItem('bucket-port') || '5290';
        return 'http://127.0.0.1:' + port;
    },

    push: function() {
        var payload = {
            enabled: State.pkTimeModEnabled === true,
            seconds: (State.pkTimeModSeconds === null || State.pkTimeModSeconds === undefined)
                ? null : State.pkTimeModSeconds
        };
        try {
            fetch(PkTimeMod.bucketBase() + '/pk-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-cache'
            }).then(function(r) { return r.json(); })
              .then(function(res) {
                  if (res && res.success) {
                      UI.addLogMessage('[时间修改] 状态已同步到代理层 | 启用='
                          + payload.enabled + ' 秒数=' + (payload.seconds === null ? '-' : payload.seconds), 'success');
                  } else {
                      UI.addLogMessage('[时间修改] 同步失败(代理层返回异常)', 'warning');
                  }
              })
              .catch(function(e) {
                  UI.addLogMessage('[时间修改] 同步失败：连不上本地服务(' + e.message + ')，确认代理已开启', 'warning');
              });
        } catch (e) {
            UI.addLogMessage('[时间修改] 同步异常：' + e.message, 'warning');
        }
    },

    // 初始化：把面板当前状态推一次，保证代理层与面板一致
    install: function() {
        PkTimeMod.push();
    }
};

function init() {
    UI.createAutoPkPanel();
    UI.createLogPanel();
    PkTimeMod.install();
    UI.addLogMessage('系统初始化完成', 'success');
    Loader.loadBucketFromServer();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        UI.showSuccessMessage();
        init();
    });
} else {
    UI.showSuccessMessage();
    init();
}
})();
