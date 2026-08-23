/* 하루 문장 — 등록한 영상의 진짜 대사로 만드는 쪽.

   AI 가 영어를 지어내면 아무리 조여도 어색한 것이 섞인다. 여기서는 영어를 만들지 않는다.
   저장소에 이미 있는 자막에서 실제로 사람이 한 말을 골라 오고,
   AI 는 **한국어와 설명만** 붙인다. 영어는 한 글자도 바꾸지 못하게 검사한다.

   덤으로 시각이 붙어 있어서 앱에서 그 대목을 실제로 들어 볼 수 있다. */
'use strict';

var fs = require('fs');
var path = require('path');
var daily = require('./daily');

var ROOT = daily.ROOT;
var DAILY = daily.DAILY;

/* 연습에 쓸 만한 줄만 고른다. 자동 자막은 토막이 많아서 그냥 쓰면 안 된다.
   문장부호로 끝나고 길이가 적당한 것만 남긴다.

   **문장부호가 아예 없는 자막은 여기서 통째로 걸러진다.** 유튜브 자동 자막 중에
   그런 것이 있는데(받아쓰기에는 써도 대사 연습에는 못 쓴다), 어느 영상이 몇 줄을
   내놓는지는 tally() 로 볼 수 있다 — 워크플로 로그에 남긴다. */
/* 자막에서 뽑아 둔 대사 창고. tools/add_subs.py 가 채운다 (PC 에서 두 달에 한 번쯤) */
function poolLines(pid) {
  var pool = daily.readJSON(path.join(ROOT, 'data', 'shows', pid, 'pool.json'), null);
  if (!pool || !pool.lines) return [];
  var out = [];
  for (var i = 0; i < pool.lines.length; i++) {
    var l = pool.lines[i];
    if (!l || !l.text) continue;
    out.push({ text: String(l.text).trim(), title: l.source || 'Subtitles',
               videoId: null, i: i, start: null, end: null });
  }
  return out;
}

/* 창고가 있으면 그쪽을 쓴다. 없으면 등록한 영상 자막에서 뽑는다 */
function candidates(pid, cfg) {
  var pool = poolLines(pid);
  if (pool.length) return pool;
  return videoLines(pid, cfg);
}

function videoLines(pid, cfg) {
  var dir = path.join(ROOT, 'data', 'videos', pid);
  var index = daily.readJSON(path.join(dir, 'index.json'), []);
  var out = [];
  var min = (cfg && cfg.showsMinWords) || 6;
  var max = (cfg && cfg.showsMaxWords) || 30;

  // 대사 연습에 안 맞는 영상은 뺀다 (강연, 뉴스 등). config 의 showsExclude
  var skip = {};
  var ex = (cfg && cfg.showsExclude) || [];
  for (var e = 0; e < ex.length; e++) skip[ex[e]] = true;

  for (var v = 0; v < index.length; v++) {
    if (skip[index[v].videoId]) continue;
    var data = daily.readJSON(path.join(dir, index[v].videoId + '.json'), null);
    if (!data || !data.sentences) continue;
    for (var s = 0; s < data.sentences.length; s++) {
      var row = data.sentences[s];
      var text = String(row.text || '').trim();
      if (!/[.!?]"?$/.test(text)) continue;          // 토막은 버린다
      var n = daily.wordCount(text);
      if (n < min || n > max) continue;
      out.push({
        text: text,
        videoId: index[v].videoId,
        title: data.title || index[v].videoId,
        i: row.i,
        start: (row.start === undefined) ? null : row.start,
        end: (row.end === undefined) ? null : row.end
      });
    }
  }
  return out;
}

/* 최근에 쓴 줄. 같은 대사가 계속 나오면 안 된다 */
function recentLines(pid, days) {
  var index = daily.readJSON(path.join(DAILY, pid, 'index.json'), []);
  var used = {};
  var seen = 0;
  for (var i = 0; i < index.length && seen < days; i++) {
    if (!index[i].hasShows) continue;
    seen++;
    var day = daily.readJSON(path.join(DAILY, pid, index[i].date + '-shows.json'), null);
    if (!day || !day.sentences) continue;
    for (var s = 0; s < day.sentences.length; s++) {
      var one = day.sentences[s];
      var f = one.from;
      if (f) used[f.videoId + '|' + f.i] = true;
      if (one.text) used['t|' + String(one.text).toLowerCase().replace(/[^a-z0-9 ]/g, '')] = true;
    }
  }
  return used;
}

function pickLines(all, used, count, rand) {
  var fresh = [];
  for (var i = 0; i < all.length; i++) {
    var a = all[i];
    if (a.videoId && used[a.videoId + '|' + a.i]) continue;
    if (used['t|' + a.text.toLowerCase().replace(/[^a-z0-9 ]/g, '')]) continue;
    fresh.push(a);
  }
  var pool = daily.shuffle(fresh.length >= count ? fresh : all, rand);
  return pool.slice(0, count);
}

/* ------------------------------------------------------------------ 지시문 */

function buildPrompt(lines, cfg) {
  var out = [];

  out.push('아래는 드라마·영화 자막에서 규칙으로 뽑아 온 영어 대사 후보입니다.');
  out.push('실제로 사람이 한 말을 그대로 가져온 것입니다.');
  out.push('이 중에서 **' + cfg.count + '개만 골라서** 한국인 성인 학습자용 연습 재료로 만들어 주세요.');
  out.push('');
  out.push('## 고르는 기준 — 이게 이 일의 절반입니다');
  out.push('');
  out.push('규칙으로는 길이와 문장부호밖에 못 봅니다. 뜻은 사람이 봐야 합니다.');
  out.push('**아래에 하나라도 걸리면 버리세요. 아까워하지 마세요.**');
  out.push('');
  out.push('1. **혼자 봐서는 뜻을 모르는 말.** 드라마 대사는 앞뒤가 있어야 통하는 것이 많습니다.');
  out.push('   "He said he would do it." 처럼 he 가 누군지 모르면 옮길 수가 없습니다');
  out.push('1-1. **화면을 봐야 아는 말.** 이게 특히 많이 새어 나갑니다. 꼭 잡아 주세요.');
  out.push('   "Oo, the next part is the best." / "Here, I will slow it down so you guys can see it."');
  out.push('   \u2014 무엇을 가리키는지 화면이 없으면 알 수 없습니다. this, that, here, the next part 가');
  out.push('   눈앞의 무언가를 가리키고 있으면 버리세요.');
  out.push('1-2. **뉴스·강연 말투.** 앵커나 발표자가 하는 말은 일상 대화가 아닙니다.');
  out.push('   "unfortunately that heat continues" 같은 것은 친구에게 쓰지 않습니다');
  out.push('2. **그 작품 안에서만 통하는 말.** 등장인물 이름, 그 드라마의 사건, 지명');
  out.push('3. **일상에서 쓸 일이 없는 말.** 총격전, 법정, 수술실, 판타지 세계의 말');
  out.push('4. **비속어 · 성적인 내용 · 폭력적인 말.** 가족이 함께 쓰는 앱입니다. 반드시 뺍니다');
  out.push('5. **배울 것이 없는 말.** 너무 뻔하거나("I am going to the store.") 단어가 다 쉬운 것');
  out.push('6. **말이 안 되는 것.** 자막이 잘못 붙었거나 두 사람 말이 섞인 것');
  out.push('');
  out.push('**골라야 할 것:** 혼자 봐도 상황이 그려지고, 일상에서 그대로 쓸 수 있고,');
  out.push('한국 사람이 그렇게 말할 줄 몰랐을 만한 표현이 들어 있는 것.');
  out.push('');
  out.push('' + cfg.count + '개를 채우지 못하겠으면 **채우지 마세요.** 억지로 넣는 것보다 적은 편이 낫습니다.');
  out.push('');
  out.push('## 고른 것에 붙일 것');
  out.push('');
  out.push('**"text" 는 한 글자도 바꾸지 마세요.** 후보에 있는 그대로 돌려주세요.');
  out.push('맞춤법이 이상해 보여도 그대로 둡니다. 실제로 그렇게 말한 것이 요점입니다.');
  out.push('');
  out.push('1. **"n"** \u2014 몇 번 후보인지 (아래 번호 그대로)');
  out.push('2. **"ko"** \u2014 학습자가 읽고 영어로 옮겨 말할 한국어.');
  out.push('   직역이 아니라 **한국 사람이 같은 상황에서 할 말**로 쓰세요.');
  out.push('   자연스러운 구어체여야 하고 애매하면 안 됩니다. 1:1로 안 맞아도 좋습니다');
  out.push('3. **"alts"** \u2014 같은 말을 말투만 바꿔 하는 법. 정확히 두 개.');
  out.push('   - "casual" \u2014 더 편하게. 짧고 축약된 구어. 관용구는 뜻이 맞을 때만');
  out.push('   - "formal" \u2014 격식 있게. 축약형 없이. **뜻을 바꾸지 마세요**');
  out.push('   둘 다 원문과 앞부분이 겹치지 않게 하세요');
  out.push('4. **"note"** \u2014 배울 만한 표현을 한국어 한두 문장으로.');
  out.push('   표현은 **별표 두 개로 감싸세요**. 감싼 것은 위 문장들 안에 실제로 나와야 합니다.');
  out.push('   문법 설명보다 **"이 말을 어떤 자리에서 쓰는가"** 를 알려 주세요');
  out.push('');
  out.push('버린 후보에 대해서는 "skipped" 에 "3번: 앞뒤를 모르면 뜻이 안 통함" 같이 한 줄씩 적으세요.');
  out.push('');
  out.push('## 후보');
  out.push('');
  for (var i = 0; i < lines.length; i++) {
    out.push((i + 1) + '. [' + lines[i].title + '] ' + lines[i].text);
  }
  out.push('');
  out.push('## 내놓는 형식');
  out.push('');
  out.push('JSON 객체 하나만. 설명, 인사말, 코드 울타리 없이.');
  out.push('');
  out.push('{ "picked": [ { "n": 3, "text": "후보 3번 그대로", "ko": "...",');
  out.push('  "alts": [ {"style":"casual","text":"..."}, {"style":"formal","text":"..."} ],');
  out.push('  "note": "..." } ], "skipped": ["1번: ...", "2번: ..."] }');

  return out.join('\n');
}

function buildSchema(count) {
  return {
    type: 'object',
    properties: {
      skipped: { type: 'array', items: { type: 'string' } },
      picked: {
        // 다 못 채우면 적게 내놓아도 된다. 억지로 채운 것보다 낫다
        type: 'array', minItems: 1, maxItems: count,
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer' },
            text: { type: 'string' },
            ko: { type: 'string' },
            alts: {
              type: 'array', minItems: 2, maxItems: 2,
              items: {
                type: 'object',
                properties: {
                  style: { type: 'string', enum: ['casual', 'formal'] },
                  text: { type: 'string' }
                },
                required: ['style', 'text']
              }
            },
            note: { type: 'string' }
          },
          required: ['n', 'text', 'ko', 'alts', 'note']
        }
      }
    },
    required: ['picked', 'skipped']
  };
}

/* ------------------------------------------------------------------ 검사 */

function same(a, b) {
  return String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
}

function validate(parsed, lines, want) {
  var problems = [];
  if (!parsed || !Array.isArray(parsed.picked)) return ['picked 목록이 없습니다.'];
  var rows = parsed.picked;
  if (!rows.length) return ['고른 대사가 하나도 없습니다.'];
  if (want && rows.length > want) {
    problems.push(want + '개까지인데 ' + rows.length + '개를 골랐습니다.');
  }
  var taken = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {}, at = '고른 것 ' + (i + 1) + ': ';

    var n = parseInt(r.n, 10);
    if (!(n >= 1 && n <= lines.length)) {
      problems.push(at + '후보 번호 ' + r.n + ' 은(는) 없습니다.');
      continue;
    }
    if (taken[n]) problems.push(at + '후보 ' + n + '번을 두 번 골랐습니다.');
    taken[n] = true;

    // 영어를 손대면 실제로 한 말이 아니게 된다. 이게 이 방식의 전부다
    if (!same(r.text, lines[n - 1].text)) {
      problems.push(at + '원래 대사를 바꿨습니다.\n      후보 ' + n + '번: ' + lines[n - 1].text
        + '\n      받은 것: ' + r.text);
    }
    if (!r.ko || !String(r.ko).trim()) problems.push(at + '한국어가 비었습니다.');
    if (!r.note || !String(r.note).trim()) problems.push(at + '설명이 비었습니다.');

    var styles = daily.altStyles(r.alts);
    if (!styles) problems.push(at + '다르게 말하는 법(alts)이 없거나 모양이 다릅니다.');
    else {
      if (!styles.casual) problems.push(at + 'casual 표현이 없습니다.');
      if (!styles.formal) problems.push(at + 'formal 표현이 없습니다.');
    }

    var keys = daily.highlighted(r.note);
    if (r.note && !keys.length) problems.push(at + 'note 에 **로 감싼 표현이 없습니다.');
    else if (keys.length && !daily.keysAppear(keys, r)) {
      problems.push(at + 'note 에서 강조한 표현이 문장에 하나도 나오지 않습니다.');
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ 저장 */

function toDayFile(parsed, lines, date) {
  var picked = parsed.picked;
  var out = {
    videoId: 'shows-' + date,
    title: 'From your videos · ' + date,
    date: date,
    source: 'shows',
    sentences: []
  };
  for (var i = 0; i < picked.length; i++) {
    var r = picked[i], src = lines[parseInt(r.n, 10) - 1];
    out.sentences.push({
      i: i,
      ko: String(r.ko).trim(),
      text: src.text,                       // 준 것을 그대로 쓴다. 받은 것을 믿지 않는다
      alts: daily.normalizeAlts(r.alts),
      note: String(r.note).trim(),
      situation: src.title,
      // 등록한 영상에서 온 것만 그 대목을 들어 볼 수 있다. 자막 창고에는 영상이 없다
      from: src.videoId ? { videoId: src.videoId, i: src.i } : null,
      start: src.start,
      end: src.end,
      recording: null
    });
  }
  return out;
}

function save(parsed, lines, date, pids, generatedAt) {
  var day = toDayFile(parsed, lines, date);
  for (var p = 0; p < pids.length; p++) {
    daily.writeJSON(path.join(DAILY, pids[p], date + '-shows.json'), day);
    markIndex(pids[p], date, day.sentences.length, generatedAt);
  }
  return day;
}

/* 목록에 "이 날은 영상 대사도 있다" 를 표시한다 */
function markIndex(pid, date, count, generatedAt) {
  var file = path.join(DAILY, pid, 'index.json');
  var rows = daily.readJSON(file, []);
  var found = false;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].date === date) { rows[i].hasShows = true; rows[i].showsCount = count; found = true; }
  }
  if (!found) {
    rows.push({ date: date, count: 0, generatedAt: generatedAt, hasShows: true, showsCount: count });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  daily.writeJSON(file, rows);
  return rows;
}

/* 어느 영상이 후보를 몇 줄 내놓는지. 0 줄이면 그 자막은 대사 연습에 못 쓴다 */
function tally(pid, cfg) {
  var out = {};
  var all = videoLines(pid, cfg);
  for (var i = 0; i < all.length; i++) {
    out[all[i].title] = (out[all[i].title] || 0) + 1;
  }
  return out;
}

module.exports = {
  candidates: candidates, poolLines: poolLines, videoLines: videoLines, tally: tally, recentLines: recentLines, pickLines: pickLines,
  buildPrompt: buildPrompt, buildSchema: buildSchema,
  validate: validate, toDayFile: toDayFile, save: save, markIndex: markIndex
};
