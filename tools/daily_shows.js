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
   문장부호로 끝나고 길이가 적당한 것만 남긴다. */
function candidates(pid, cfg) {
  var dir = path.join(ROOT, 'data', 'videos', pid);
  var index = daily.readJSON(path.join(dir, 'index.json'), []);
  var out = [];
  var min = (cfg && cfg.showsMinWords) || 6;
  var max = (cfg && cfg.showsMaxWords) || 30;

  for (var v = 0; v < index.length; v++) {
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
      var f = day.sentences[s].from;
      if (f) used[f.videoId + '|' + f.i] = true;
    }
  }
  return used;
}

function pickLines(all, used, count, rand) {
  var fresh = [];
  for (var i = 0; i < all.length; i++) {
    if (!used[all[i].videoId + '|' + all[i].i]) fresh.push(all[i]);
  }
  var pool = daily.shuffle(fresh.length >= count ? fresh : all, rand);
  return pool.slice(0, count);
}

/* ------------------------------------------------------------------ 지시문 */

function buildPrompt(lines, cfg) {
  var out = [];

  out.push('아래 영어 문장들은 실제 영상에서 사람이 한 말입니다. 자막에서 그대로 가져온 것입니다.');
  out.push('한국인 성인 학습자가 이 문장을 보고 연습할 수 있게 재료를 붙여 주세요.');
  out.push('');
  out.push('## 절대 지킬 것');
  out.push('');
  out.push('**"text" 는 한 글자도 바꾸지 마세요.** 준 그대로 돌려주세요.');
  out.push('맞춤법이 이상해 보여도, 문장이 어색해 보여도 그대로 둡니다.');
  out.push('실제로 그렇게 말한 것이 요점입니다. 고치면 이 연습의 의미가 없어집니다.');
  out.push('');
  out.push('## 붙일 것');
  out.push('');
  out.push('1. **"ko"** \u2014 학습자가 읽고 영어로 옮겨 말할 한국어.');
  out.push('   직역이 아니라 **한국 사람이 같은 상황에서 할 말**로 쓰세요.');
  out.push('   자연스러운 구어체여야 하고, 애매하게 쓰지 마세요.');
  out.push('   영어 문장의 뜻과 느낌이 전해지면 됩니다. 1:1로 안 맞아도 좋습니다.');
  out.push('2. **"alts"** \u2014 같은 말을 말투만 바꿔 하는 법. 정확히 두 개.');
  out.push('   - "casual" \u2014 더 편하게. 짧고 축약된 구어. 관용구는 뜻이 맞을 때만');
  out.push('   - "formal" \u2014 격식 있게. 축약형 없이. **뜻을 바꾸지 마세요**');
  out.push('   둘 다 원문과 앞부분이 겹치지 않게 하세요.');
  out.push('3. **"note"** \u2014 배울 만한 표현을 한국어 한두 문장으로.');
  out.push('   표현은 **별표 두 개로 감싸세요**. 감싼 것은 위 문장들 안에 실제로 나와야 합니다.');
  out.push('   문법 설명보다 **"이 말을 어떤 자리에서 쓰는가"** 를 알려 주세요.');
  out.push('');
  out.push('## 재료');
  out.push('');
  for (var i = 0; i < lines.length; i++) {
    out.push((i + 1) + '. [' + lines[i].title + '] ' + lines[i].text);
  }
  out.push('');
  out.push('## 내놓는 형식');
  out.push('');
  out.push('JSON 객체 하나만. 설명, 인사말, 코드 울타리 없이.');
  out.push('"sentences" 에 위 순서 그대로 ' + lines.length + '개를 담으세요.');
  out.push('');
  out.push('{ "sentences": [ { "text": "준 문장 그대로", "ko": "...",');
  out.push('  "alts": [ {"style":"casual","text":"..."}, {"style":"formal","text":"..."} ],');
  out.push('  "note": "..." } ] }');

  return out.join('\n');
}

function buildSchema(count) {
  return {
    type: 'object',
    properties: {
      sentences: {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object',
          properties: {
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
          required: ['text', 'ko', 'alts', 'note']
        }
      }
    },
    required: ['sentences']
  };
}

/* ------------------------------------------------------------------ 검사 */

function same(a, b) {
  return String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
}

function validate(parsed, lines) {
  var problems = [];
  if (!parsed || !Array.isArray(parsed.sentences)) return ['sentences 목록이 없습니다.'];
  var rows = parsed.sentences;
  if (rows.length !== lines.length) {
    problems.push('문장이 ' + lines.length + '개여야 하는데 ' + rows.length + '개입니다.');
  }
  for (var i = 0; i < rows.length && i < lines.length; i++) {
    var r = rows[i] || {}, at = '문장 ' + (i + 1) + ': ';

    // 영어를 손대면 실제로 한 말이 아니게 된다. 이게 이 방식의 전부다
    if (!same(r.text, lines[i].text)) {
      problems.push(at + '원래 대사를 바꿨습니다.\n      준 것: ' + lines[i].text
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
  var out = {
    videoId: 'shows-' + date,
    title: 'From your videos · ' + date,
    date: date,
    source: 'shows',
    sentences: []
  };
  for (var i = 0; i < parsed.sentences.length; i++) {
    var r = parsed.sentences[i], src = lines[i];
    out.sentences.push({
      i: i,
      ko: String(r.ko).trim(),
      text: src.text,                       // 준 것을 그대로 쓴다. 받은 것을 믿지 않는다
      alts: daily.normalizeAlts(r.alts),
      note: String(r.note).trim(),
      situation: src.title,
      from: { videoId: src.videoId, i: src.i },
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

module.exports = {
  candidates: candidates, recentLines: recentLines, pickLines: pickLines,
  buildPrompt: buildPrompt, buildSchema: buildSchema,
  validate: validate, toDayFile: toDayFile, save: save, markIndex: markIndex
};
