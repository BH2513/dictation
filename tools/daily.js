/* 하루 다섯 문장 — 만드는 쪽 (ROADMAP 1단계).

   GitHub Actions 가 매일 한 번 돌린다. 두 갈래로 쓴다.
     1) daily_prompt.js  저장소 상태를 읽어 Claude 에게 줄 지시문을 만든다
     2) daily_save.js    Claude 가 뱉은 것을 검사해서 data/daily/ 에 넣는다

   Claude 를 도구 권한 없이 돌리기 위해 일부러 갈라 놓았다 — 지시문은 글로 주고,
   결과는 표준출력으로 받아 이쪽에서 파일로 쓴다. 그래야 권한 절차를 아예 안 탄다.

   앱이 읽는 파일 모양은 영상 파일과 같게 맞춘다. 그래야 문장카드가 그대로 붙는다. */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DAILY = path.join(ROOT, 'data', 'daily');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function config() {
  var c = readJSON(path.join(DAILY, 'config.json'), null);
  if (!c) throw new Error('data/daily/config.json 을 읽지 못했습니다.');
  return c;
}

function profileIds() {
  var rows = readJSON(path.join(ROOT, 'data', 'profiles.json'), []);
  var out = [];
  for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].id) out.push(rows[i].id);
  return out;
}

/* 오늘 날짜(YYYY-MM-DD). 한국 기준으로 잡는다 — 아침에 열었을 때 오늘 것이 있어야 한다. */
function todayKST(now) {
  var t = (now || new Date()).getTime() + 9 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ 지시문 만들기 */

/* 최근 며칠에 이미 쓴 상황. 같은 상황이 계속 나오면 연습이 지겨워진다. */
function recentSituations(pid, days) {
  var index = readJSON(path.join(DAILY, pid, 'index.json'), []);
  var used = {};
  for (var i = 0; i < index.length && i < days; i++) {
    var day = readJSON(path.join(DAILY, pid, index[i].date + '.json'), null);
    if (!day || !day.sentences) continue;
    for (var s = 0; s < day.sentences.length; s++) {
      if (day.sentences[s].situation) used[day.sentences[s].situation] = true;
    }
  }
  return Object.keys(used);
}

function shuffle(list, rand) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor((rand || Math.random)() * (i + 1));
    var t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/* 오늘 쓸 상황을 고른다. 최근에 쓴 것은 뒤로 미룬다 —
   전부 최근에 썼더라도 빈손으로 돌아오면 안 되므로 모자라면 채워 넣는다. */
function pickSituations(all, recent, count, rand) {
  var isRecent = {};
  for (var r = 0; r < recent.length; r++) isRecent[recent[r]] = true;
  var fresh = [], stale = [];
  for (var i = 0; i < all.length; i++) {
    (isRecent[all[i]] ? stale : fresh).push(all[i]);
  }
  var pool = shuffle(fresh, rand).concat(shuffle(stale, rand));
  return pool.slice(0, count);
}

/* 지금 받아쓰기로 듣고 있는 영상에서 어휘를 뽑는다.
   같은 낱말을 듣고 또 말해 보게 하려는 것이다. 짧고 흔한 낱말은 도움이 안 되므로 뺀다. */
function vocabulary(pid, sample, rand) {
  var dir = path.join(ROOT, 'data', 'videos', pid);
  var index = readJSON(path.join(dir, 'index.json'), []);
  var seen = {};
  for (var v = 0; v < index.length; v++) {
    var data = readJSON(path.join(dir, index[v].videoId + '.json'), null);
    if (!data || !data.sentences) continue;
    for (var s = 0; s < data.sentences.length; s++) {
      var words = String(data.sentences[s].text || '').split(/\s+/);
      for (var w = 0; w < words.length; w++) {
        var one = words[w].toLowerCase().replace(/[^a-z']/g, '');
        if (one.length >= 7) seen[one] = true;
      }
    }
  }
  return shuffle(Object.keys(seen), rand).slice(0, sample);
}

function buildPrompt(opts) {
  var count = opts.count;
  var lines = [];

  lines.push('당신은 한국인 성인 학습자의 영어 회화 선생입니다.');
  lines.push('이 사람은 중급을 넘어선 수준이라 교과서 문장은 도움이 되지 않습니다.');
  lines.push('오늘 연습할 문장 ' + count + '개를 만들어 주세요.');
  lines.push('');
  lines.push('학습자는 한국어 문장을 보고 영어로 옮겨 **말하는** 연습을 합니다.');
  lines.push('맞히기 시험이 아니라 말해 보는 연습이므로, 정답이 하나일 필요는 없습니다.');
  lines.push('중요한 것은 그 영어가 **실제로 사람들이 그렇게 말하는가** 입니다.');
  lines.push('');
  lines.push('## 말투 — 이게 제일 중요합니다');
  lines.push('- **친구 · 가족 · 편한 동료에게 하는 일상 대화체**로 쓰세요');
  lines.push('- 격식체, 비즈니스 영어, 뉴스 문어체는 쓰지 마세요');
  lines.push('- 축약형(I\'m, don\'t, it\'s, I\'d, that\'s)을 자연스럽게 쓰세요. 안 쓰면 딱딱해집니다');
  lines.push('- honestly, kind of, basically, actually, I guess 같은 말버릇이 들어가면 좋습니다');
  lines.push('- 말하다 보니 길어진 문장처럼 and / but / so / because 로 이어 가세요');
  lines.push('- **소리내어 읽었을 때 어색하면 다시 쓰세요.** 글로 쓴 문장 같으면 안 됩니다');
  lines.push('');
  lines.push('## 길이와 난이도');
  lines.push('- 영어 문장은 ' + opts.minWords + '~' + opts.maxWords + ' 단어');
  lines.push('- 절이 둘 이상. 관계절 / 가정법 / 시간·이유를 잇는 절 중 하나 이상은 들어가야 합니다');
  lines.push('  (예: the thing that ~ / if I had known ~ / which is why ~ / by the time I ~)');
  lines.push('- 쉬운 문장은 만들지 마세요. 짧고 단순한 문장은 이 연습의 목적에 어긋납니다');
  lines.push('- 캐주얼한 말투와 긴 문장은 얼마든지 같이 갑니다. 말이 길어지는 것이지 어려워지는 것이 아닙니다');
  lines.push('');
  lines.push('## 오늘 쓸 상황 — 문장 하나에 상황 하나씩, 순서대로');
  for (var i = 0; i < opts.situations.length; i++) {
    lines.push((i + 1) + '. ' + opts.situations[i]);
  }
  if (opts.vocab && opts.vocab.length) {
    lines.push('');
    lines.push('## 어휘 참고');
    lines.push('학습자가 지금 받아쓰기로 듣고 있는 영상에 나온 낱말입니다.');
    lines.push('일상 대화에 자연스럽게 어울리는 것만 골라 쓰세요. 억지로 넣으면 말투가 망가집니다.');
    lines.push(opts.vocab.join(', '));
  }
  lines.push('');
  lines.push('## 내놓는 형식');
  lines.push('아래 모양의 JSON 객체 하나만 출력하세요. 설명, 인사말, 코드 울타리 없이 JSON 만.');
  lines.push('');
  lines.push('{');
  lines.push('  "sentences": [');
  lines.push('    {');
  lines.push('      "situation": "위에 준 상황을 그대로",');
  lines.push('      "ko": "학습자가 읽을 한국어 문장. 실제로 한국 사람이 그렇게 말하는 자연스러운 구어체",');
  lines.push('      "text": "영어 문장",');
  lines.push('      "alts": ["같은 뜻을 다르게 말한 것 2~3개"],');
  lines.push('      "note": "핵심 표현이나 말버릇을 한국어 한두 문장으로"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('');
  lines.push('"alts" 는 채점용이 아니라 **다르게 말하는 법을 보여 주려는 것**입니다.');
  lines.push('같은 상황에서 실제로 쓸 법한 다른 말투를 넣어 주세요. 길이는 비슷하면 됩니다.');
  lines.push('"ko" 는 번역투가 아니어야 합니다. 한국 사람이 친구한테 하듯 쓰세요.');
  lines.push('문장부호는 쉼표와 마침표만 쓰세요. 줄표(\u2014)와 따옴표는 쓰지 마세요.');

  return lines.join('\n');
}

/* ------------------------------------------------------------------ 결과 받기 */

/* Claude 가 앞뒤에 말을 붙이거나 코드 울타리를 씌워도 JSON 만 꺼낸다. */
function extractJSON(raw) {
  var text = String(raw || '');
  var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('결과에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(text.slice(start, end + 1));
}

/* Claude Code CLI 는 --output-format json 으로 부르면 겉봉투를 씌워서 준다.
   봉투째 넘겨도, 알맹이만 넘겨도 되게 한다. */
function unwrap(parsed) {
  if (parsed && parsed.structured_output) return parsed.structured_output;
  if (parsed && typeof parsed.result === 'string') return extractJSON(parsed.result);
  return parsed;
}

/* --json-schema 로 넘길 형식. 칸이 비는 것은 이걸로 막고,
   단어 수처럼 형식으로 못 막는 것은 validate() 가 잡는다. */
function buildSchema(cfg) {
  return {
    type: 'object',
    properties: {
      sentences: {
        type: 'array',
        minItems: cfg.count,
        maxItems: cfg.count,
        items: {
          type: 'object',
          properties: {
            situation: { type: 'string' },
            ko: { type: 'string' },
            text: { type: 'string' },
            alts: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
            note: { type: 'string' }
          },
          required: ['situation', 'ko', 'text', 'alts', 'note']
        }
      }
    },
    required: ['sentences']
  };
}

function wordCount(text) {
  var t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/* 검사에서 걸리면 그날 파일을 아예 안 쓴다. 반쯤 망가진 문장을 넣느니 건너뛰는 게 낫다. */
function validate(parsed, cfg) {
  var problems = [];
  if (!parsed || !Array.isArray(parsed.sentences)) {
    return ['sentences 목록이 없습니다.'];
  }
  var rows = parsed.sentences;
  if (rows.length !== cfg.count) {
    problems.push('문장이 ' + cfg.count + '개여야 하는데 ' + rows.length + '개입니다.');
  }
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var at = '문장 ' + (i + 1) + ': ';
    if (!r.ko || !String(r.ko).trim()) problems.push(at + '한국어가 비었습니다.');
    if (!r.situation || !String(r.situation).trim()) problems.push(at + '상황이 비었습니다.');
    if (!r.note || !String(r.note).trim()) problems.push(at + '설명이 비었습니다.');

    var n = wordCount(r.text);
    if (!n) {
      problems.push(at + '영어 문장이 비었습니다.');
    } else if (n < cfg.minWords || n > cfg.maxWords) {
      problems.push(at + '영어 문장이 ' + n + ' 단어입니다 ('
        + cfg.minWords + '~' + cfg.maxWords + ' 이어야 합니다).');
    }

    var key = String(r.text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (key && seen[key]) problems.push(at + '앞 문장과 같습니다.');
    seen[key] = true;

    if (!Array.isArray(r.alts) || !r.alts.length) {
      problems.push(at + '다른 정답(alts)이 없습니다.');
    } else {
      for (var a = 0; a < r.alts.length; a++) {
        if (!r.alts[a] || !String(r.alts[a]).trim()) problems.push(at + '다른 정답이 비었습니다.');
      }
    }
  }
  return problems;
}

/* 앱이 읽는 모양으로 바꾼다. 영상 파일과 같은 모양이라 문장카드가 그대로 붙는다. */
function toDayFile(parsed, date) {
  var out = {
    videoId: 'daily-' + date,
    title: 'Daily sentences · ' + date,
    date: date,
    source: 'daily',
    sentences: []
  };
  for (var i = 0; i < parsed.sentences.length; i++) {
    var r = parsed.sentences[i];
    out.sentences.push({
      i: i,
      ko: String(r.ko).trim(),
      text: String(r.text).trim(),
      alts: r.alts.map(function (a) { return String(a).trim(); }),
      note: String(r.note).trim(),
      situation: String(r.situation).trim(),
      start: null,
      end: null,
      recording: null
    });
  }
  return out;
}

/* 목록은 새 날짜가 앞에 오게 둔다. 앱이 첫 줄만 봐도 최신을 안다. */
function updateIndex(pid, date, count, generatedAt) {
  var file = path.join(DAILY, pid, 'index.json');
  var rows = readJSON(file, []);
  var out = [];
  for (var i = 0; i < rows.length; i++) if (rows[i].date !== date) out.push(rows[i]);
  out.push({ date: date, count: count, generatedAt: generatedAt });
  out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  writeJSON(file, out);
  return out;
}

function save(parsed, date, pids, generatedAt) {
  var day = toDayFile(parsed, date);
  var written = [];
  for (var p = 0; p < pids.length; p++) {
    writeJSON(path.join(DAILY, pids[p], date + '.json'), day);
    updateIndex(pids[p], date, day.sentences.length, generatedAt);
    written.push(pids[p]);
  }
  return { day: day, profiles: written };
}

module.exports = {
  ROOT: ROOT, DAILY: DAILY,
  readJSON: readJSON, writeJSON: writeJSON,
  config: config, profileIds: profileIds, todayKST: todayKST,
  recentSituations: recentSituations, pickSituations: pickSituations,
  shuffle: shuffle, vocabulary: vocabulary, buildPrompt: buildPrompt,
  extractJSON: extractJSON, unwrap: unwrap, buildSchema: buildSchema,
  wordCount: wordCount, validate: validate,
  toDayFile: toDayFile, updateIndex: updateIndex, save: save
};
