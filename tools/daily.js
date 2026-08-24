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
function recentSituations(pid, days, sets) {
  var used = {};

  // 옛 날짜 파일 — 묶음으로 옮기기 전에 만든 것들.
  // 날짜를 실제로 견준다. 앞에서 몇 개를 세기만 하면 옛 파일이 영영 남아
  // 피할 상황이 줄지 않는다 (그 파일은 더 늘지도 않는다)
  var index = readJSON(path.join(DAILY, pid, 'index.json'), []);
  var cutoff = new Date(new Date(todayKST() + 'T00:00:00Z').getTime()
    - (days || 14) * 86400000).toISOString().slice(0, 10);
  for (var i = 0; i < index.length; i++) {
    if (!index[i] || String(index[i].date) < cutoff) continue;
    var day = readJSON(path.join(DAILY, pid, index[i].date + '.json'), null);
    if (!day || !day.sentences) continue;
    for (var s = 0; s < day.sentences.length; s++) {
      if (day.sentences[s].situation) used[day.sentences[s].situation] = true;
    }
  }

  // 묶음 — 지금은 이쪽에 쌓인다. 이걸 안 읽어서 한 번에 만든 세 묶음에
  // 같은 상황이 두 번씩 나왔다. 하루에 여러 묶음을 만들므로 날짜가 아니라 개수로 센다
  var ids = allSetIds(pid);
  var from = Math.max(0, ids.length - (sets || 4));
  for (var r = from; r < ids.length; r++) {
    var one = readJSON(path.join(DAILY, pid, 'sets', ids[r] + '.json'), null);
    if (!one || !one.sentences) continue;
    for (var t = 0; t < one.sentences.length; t++) {
      if (one.sentences[t].situation) used[one.sentences[t].situation] = true;
    }
  }

  return Object.keys(used);
}

/* 최근 묶음에 나온 영어. 지시문에 넣어 같은 내용을 다시 만들지 않게 한다 —
   상황이 달라도 "팔이 안 올라가서 머리를 못 감았다" 가 두 번 나온 적이 있다. */
function recentTexts(pid, sets) {
  var ids = allSetIds(pid);
  var out = [];
  var from = Math.max(0, ids.length - (sets || 4));
  for (var r = from; r < ids.length; r++) {
    var one = readJSON(path.join(DAILY, pid, 'sets', ids[r] + '.json'), null);
    if (!one || !one.sentences) continue;
    for (var t = 0; t < one.sentences.length; t++) {
      if (one.sentences[t].text) out.push(String(one.sentences[t].text));
    }
  }
  return out;
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

/* 진짜 원어민 대사를 뽑아 온다. 지시문에 본보기로 넣는다.

   모델은 규칙이 아니라 **눈앞에 보이는 예문**을 따라 한다. 실제로 겪었다 —
   길이 규칙을 다 걷어냈는데도 평균이 24.5 단어로 오히려 늘었다. 그때 지시문이
   보여 주던 유일한 예문이 우리가 전에 만든 문장 40개(평균 23.1 단어)였다.

   그래서 진짜 대사를 보여 준다. 자막에서 실제로 한 말이라 평균 12.6 단어다.
   문장부호가 없는 자동자막은 뺀다 — 어디서 끊기는지 알 수 없다. */
function realLines(pid, want, rand, cfg) {
  var dir = path.join(ROOT, 'data', 'videos', pid);
  var index = readJSON(path.join(dir, 'index.json'), []);
  var skip = {};
  var ex = (cfg && cfg.showsExclude) || [];
  for (var e = 0; e < ex.length; e++) skip[ex[e]] = true;   // 강연·뉴스는 대사가 아니다

  var out = [];
  for (var v = 0; v < index.length; v++) {
    if (skip[index[v].videoId]) continue;
    var data = readJSON(path.join(dir, index[v].videoId + '.json'), null);
    if (!data || !data.sentences) continue;
    var rows = data.sentences, marked = 0;
    for (var c = 0; c < rows.length; c++) if (/[.?!,]/.test(String(rows[c].text || ''))) marked++;
    if (!rows.length || marked / rows.length <= 0.5) continue;   // 자동자막은 통째로 건너뛴다
    for (var s = 0; s < rows.length; s++) {
      var text = String(rows[s].text || '').trim();
      if (!/^[A-Z]/.test(text) || !/[.?!]$/.test(text)) continue;
      if (text === text.toUpperCase()) continue;                 // 다 대문자인 줄은 뺀다
      if (/["\u201c\u201d]/.test(text)) continue;                   // 따옴표가 있으면 인용이라 혼자 안 선다
      if (/\b(um|uh|erm)\b/i.test(text)) continue;                // 받아적기 잡음
      if (/\b(\w+)\s+\1\b/i.test(text)) continue;                 // 겹쳐 말한 자리 (do you can't do)
      if (/\b(Dr|Mr|Mrs|Ms|St|Jr|vs)\.$/i.test(text)) continue;      // 줄임말에서 잘린 토막
      var n = wordCount(text);
      if (n < 8 || n > 24) continue;
      out.push(text);
    }
  }
  return shuffle(out, rand).slice(0, want || 12);
}

function buildPrompt(opts) {
  var count = opts.count;
  var lines = [];

  lines.push('당신은 한국인 성인 학습자의 영어 회화 선생입니다.');
  lines.push('이 사람은 중급을 넘어선 수준이라 교과서 문장은 도움이 되지 않습니다.');
  lines.push('오늘 연습할 문장 ' + count + '개를 만들어 주세요.');
  lines.push('');
  lines.push('학습자는 이 영어를 **소리내어 말하는** 연습을 합니다.');
  lines.push('맞히기 시험이 아니므로 정답이 하나일 필요는 없습니다.');
  lines.push('중요한 것은 그 영어가 **실제로 사람들이 그렇게 말하는가** 하나뿐입니다.');
  lines.push('');
  lines.push('## 한국어는 생각하지 마세요');
  lines.push('');
  lines.push('**여기서는 영어만 만듭니다.** 한국어는 나중에 다른 자리에서 붙입니다.');
  lines.push('그러니 **옮기기 좋은 영어**를 쓰려고 하지 마세요. 한국어와 짝이 맞는지도 보지 마세요.');
  lines.push('그런 것을 생각하는 순간 번역체가 됩니다 \u2014 실제로 그렇게 나온 적이 있습니다.');
  lines.push('');
  lines.push('그 상황에 놓인 사람이 **실제로 뭐라고 말할지**만 떠올려서 쓰세요.');
  lines.push('쓴 다음 소리내어 읽어 보고, 조금이라도 어색하면 버리고 다시 만듭니다.');
  lines.push('');
  lines.push('## \uc8fc\uc758 \u2014 \ud55c\uad6d\uc5d0\ub9cc \uc788\ub294 \uac83\uc744 \uc601\uc5b4\ub85c \uc62e\uae30\uc9c0 \ub9c8\uc138\uc694');
  lines.push('');
  lines.push('아래 상황은 **어떤 이야기를 할지 정해 주는 것**일 뿐입니다.');
  lines.push('한국어로 적혀 있다고 해서 한국 제도나 관습을 영어 낱말로 바꿔 놓으면 안 됩니다.');
  lines.push('영어권에 없는 것은 **영어권 사람이 같은 처지에서 실제로 하는 말**로 씁니다.');
  lines.push('');
  lines.push('- 회식의 1차 · 2차를 first round, second round 로 옮기면 안 됩니다.');
  lines.push('  영어의 round 는 술을 한 차례 돌리는 것이지 자리를 옮기는 것이 아닙니다.');
  lines.push('  실제로 그렇게 나간 적이 있습니다 \u2014 원어민은 그냥 늦게까지 붙잡혀 있다고 말합니다.');
  lines.push('- 수능, 명절 차례, 전세, 학원, 회식처럼 **설명이 필요한 것은 아예 넣지 마세요.**');
  lines.push('  그 자리에 영어권에도 있는 것을 넣으면 됩니다 (저녁 모임, 시험, 월세, 수업).');
  lines.push('- **돈은 달러로 씁니다.** 원 단위를 그대로 쓰지 마세요.');
  lines.push('');
  lines.push('가늠하는 법: **한국을 모르는 사람이 읽어도 그대로 통하는가.**');
  lines.push('설명이 필요하면 그건 영어 문장이 아니라 한국어를 옮겨 놓은 것입니다.');
  lines.push('');
  lines.push('## 이건 글이 아니라 말입니다');
  lines.push('');
  lines.push('학습자는 이 영어를 **귀로 듣고** 입으로 따라 말합니다.');
  lines.push('글은 걸리면 다시 읽으면 되지만 말은 한 번뿐입니다.');
  lines.push('그래서 **듣는 사람이 한 번에 알아듣지 못하면 그 문장은 실패입니다.**');
  lines.push('');
  lines.push('- **이어 주는 말을 빼지 마세요.** 사람은 so, but, and then, because 로 이어 말합니다.');
  lines.push('  그걸 빼고 문장을 나란히 붙여 놓으면 듣는 사람이 그 사이를 짐작해야 합니다.');
  lines.push('  그게 글입니다. 실제로 그렇게 나간 적이 있습니다 \u2014');
  lines.push('  I could have waited. I drove home. 은 왜 그냥 왔는지가 빠져서');
  lines.push('  마지막 줄이 뚝 떨어집니다. 말로는 I could have waited, but I just drove home. 입니다.');
  lines.push('- **왜 그런지를 입으로 말하세요.** 짐작하게 두면 안 됩니다.');
  lines.push('  고양이가 가슴 위에서 자는데 팔이 저리다고만 적으면, 왜 팔이 저린지');
  lines.push('  왜 그냥 누워 있는지를 듣는 사람이 지어내야 합니다. 사람은 그 이유를 입으로 말합니다.');
  lines.push('- **마지막에 뒤집는 한 줄을 두지 마세요.** 글은 뜻을 끝까지 아끼다가 마지막에 터뜨립니다.');
  lines.push('  말은 그러지 않습니다 \u2014 할 말을 앞에 놓고 뒤에서 풀어 줍니다.');
  lines.push('');
  lines.push('가늠하는 법: **눈으로 읽어야 알겠으면 실패입니다.**');
  lines.push('잘 쓴 글을 만들지 마세요. 사람이 입으로 하는 말을 그대로 적으세요.');
  lines.push('');
  if (opts.real && opts.real.length) {
    var sum = 0;
    for (var q = 0; q < opts.real.length; q++) sum += wordCount(opts.real[q]);
    var avg = Math.round(sum / opts.real.length);
    lines.push('## 사람은 이렇게 말합니다 \u2014 진짜 대사');
    lines.push('');
    lines.push('아래는 **드라마에서 실제로 한 말을 자막 그대로 옮긴 것**입니다. 지어낸 문장이 아닙니다.');
    lines.push('');
    for (var y = 0; y < opts.real.length; y++) lines.push('- ' + opts.real[y]);
    lines.push('');
    lines.push('**내용은 베끼지 마세요.** 여기서 볼 것은 둘뿐입니다 \u2014');
    lines.push('**얼마나 짧은지**, 그리고 **누구에게 하는 말인지.**');
    lines.push('');
    lines.push('세어 보면 평균 ' + avg + ' 단어쯤입니다. 우리가 전에 만든 것은 24 단어였습니다.');
    lines.push('**당신이 만들 문장도 이 정도여야 합니다.** 그리고 대부분이 **앞에 있는 사람에게** 하는 말입니다 \u2014');
    lines.push('혼자 겪은 일을 적어 내려간 수기가 아닙니다.');
    lines.push('');
  }
  lines.push('## 영어 문장 \u2014 이게 제일 중요합니다');
  lines.push('');
  lines.push('- **자연스러움이 다른 모든 조건보다 먼저입니다.** 규칙을 채우려고');
  lines.push('  말을 늘리거나 덧붙이지 마세요. 할 말이 끝났으면 거기서 끝냅니다.');
  lines.push('  **한 문장으로 끝나도 됩니다.** 두 문장이 자연스러우면 두 문장으로 쓰세요.');
  lines.push('- 친구 · 가족 · 편한 동료에게 하는 말투. 격식체, 비즈니스 영어, 뉴스 문어체는 안 됩니다');
  lines.push('- 축약형(I\'m, don\'t, it\'s, I\'d, that\'s)을 자연스럽게 쓰세요');
  lines.push('- **말버릇(like, I mean, you know, kind of)을 겁내지 마세요.** 사람 말에는 원래 섞여 있습니다.');
  lines.push('  진짜 대사를 세어 보니 넷 중 하나에 들어 있었습니다. 다만 뜻 없이 장식으로 붙이지는 마세요.');
  lines.push('- **원어민이 안 쓰는 낱말을 고르지 마세요.** 뜻은 맞아도 그 자리에서 안 쓰는 말이 있습니다');
  lines.push('  (배달을 다시 시키는 것은 reorder 가 아니라 order again 입니다).');
  lines.push('- **두 가지로 읽히는 말을 피하세요.** 문법이 맞아도 순간 헷갈리면 안 됩니다');
  lines.push('  (caved on day three 는 맞지만 cave on ~ 으로도 읽혀서 걸립니다. caved three days in 이 낫습니다).');
  lines.push('');
  lines.push('## 길이와 난이도');
  lines.push('- **길이는 세지 마세요.** 자연스러운 말이 끝나는 데서 끝내면 됩니다.');
  lines.push('  울타리는 하나뿐입니다 \u2014 다 합쳐서 ' + opts.maxWords + ' 단어를 넘지 마세요.');
  lines.push('  (듣고 외워서 따라 말해야 하므로 그보다 길면 연습이 안 됩니다.)');
  lines.push('  **하한은 없습니다. 여덟 단어로 끝나도 됩니다.**');
  lines.push('  진짜 대사 1,458줄을 세어 보니 열에 아홉이 20 단어 이하였고 절반 넘게가 12 단어도 안 됐습니다.');
  lines.push('  전에 하한을 12 단어로 두었더니 진짜 말이 사는 자리를 통째로 막고 있었습니다.');
  lines.push('- **짧게 만드는 법은 압축이 아니라 덜 말하는 것입니다.**');
  lines.push('  할 말이 적어서 짧은 것이지, 할 말을 줄여 담아서 짧은 것이 아닙니다.');
  lines.push('  이어 주는 말을 빼서 줄이면 짧아지기는 하지만 말이 아니라 글이 됩니다.');
  lines.push('- **난이도는 길이가 아니라 내용에서 나옵니다.** 짧아도 어려울 수 있습니다');
  lines.push('  낱말은 쉽게, 내용은 어렵게. 어른이 실제로 겪는 복잡한 사정을 담으세요 \u2014');
  lines.push('  가정("~했으면 ~했을 텐데"), 조건, 이유, 마음이 반쯤 바뀐 상태 같은 것.');
  lines.push('  "좋았어요" "힘들어요" 수준으로 단순하면 연습이 안 됩니다');
  lines.push('');
  lines.push('## 오늘 쓸 상황 — 문장 하나에 상황 하나씩, 순서대로');
  for (var i = 0; i < opts.situations.length; i++) {
    lines.push((i + 1) + '. ' + opts.situations[i]);
  }
  if (opts.recent && opts.recent.length) {
    lines.push('');
    lines.push('## 최근에 이미 나온 문장 \u2014 겹치지 마세요');
    lines.push('**이건 겹치지 않으려고 보여 주는 것이지 본보기가 아닙니다.**');
    lines.push('길이와 말투는 위의 진짜 대사를 보세요. 아래 것들은 너무 깁니다.');
    lines.push('상황이 달라도 **같은 이야기를 다시 만들면 안 됩니다.**');
    lines.push('("팔이 안 올라가서 머리를 못 감았다" 가 두 묶음에 그대로 나온 적이 있습니다.)');
    for (var v = 0; v < opts.recent.length; v++) lines.push('- ' + opts.recent[v]);
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
  lines.push('{ "texts": ["1번 영어", "2번 영어", ...] }');
  lines.push('');
  lines.push('**' + count + '개**여야 하고, 위에 준 상황 **순서 그대로**여야 합니다.');
  lines.push('줄표(\u2014)와 따옴표는 쓰지 마세요. **물음표와 느낌표는 써도 됩니다** \u2014');
  lines.push('사람은 되묻고 놀랍니다. 진짜 대사 열 줄 중 하나가 물음이었습니다.');

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
function sentenceListSchema(cfg) {
  return {
    type: 'array',
    minItems: cfg.count,
    maxItems: cfg.count,
    items: {
      type: 'object',
      properties: {
        situation: { type: 'string' },
        ko: { type: 'string' },
        text: { type: 'string' },
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
      required: ['situation', 'ko', 'text', 'alts', 'note']
    }
  };
}

/* 만드는 단계는 영어만 낸다. 한국어와 말투는 뒤 단계에서 붙인다 (운영자 결정) */
function buildSchema(cfg) {
  return {
    type: 'object',
    properties: {
      texts: {
        type: 'array', minItems: cfg.count, maxItems: cfg.count,
        items: { type: 'string' }
      }
    },
    required: ['texts']
  };
}

/* 검사하는 쪽은 고친 문장과 무엇을 고쳤는지를 같이 내놓는다 */
function buildReviewSchema(cfg) {
  return {
    type: 'object',
    properties: {
      problems: { type: 'array', items: { type: 'string' } },
      sentences: sentenceListSchema(cfg)
    },
    required: ['problems', 'sentences']
  };
}

/* ------------------------------------------------------------------ 말투 바꾸기

   확정된 영어에서 casual / formal 을 만든다. **여기도 영어만 다룬다** —
   한국어는 아직 없다. 한국어를 옆에 두면 말투가 아니라 번역을 보게 된다. */

function buildAltsPrompt(draft) {
  var rows = (draft && draft.sentences) || [];
  var lines = [];

  lines.push('당신은 영어가 모국어인 사람입니다. 아래 영어를 **말투만 바꿔** 두 가지로 다시 써 주세요.');
  lines.push('');
  lines.push('**뜻을 바꾸지 마세요.** 내용을 더하거나 빼거나 눅이면 안 됩니다.');
  lines.push('숫자와 기간은 그대로 두세요 \u2014 전에 eight months 를 since winter 로 바꿔 놓은 적이 있습니다.');
  lines.push('');
  lines.push('- **casual** \u2014 더 편한 말투. **관용구를 억지로 넣는 것이 아닙니다.**');
  lines.push('  더 짧게, 더 축약해서(I\'m, gonna, kinda), 말하듯이 하는 것이 캐주얼입니다.');
  lines.push('  관용구는 **뜻이 정확히 맞을 때만** 쓰세요. 어설프게 쓰면 틀린 영어를 가르치게 됩니다.');
  lines.push('  ("hit the spot" 은 음식이 딱 땡길 때, "call it a day" 는 일을 그만둘 때 \u2014');
  lines.push('   이런 것을 엉뚱한 자리에 넣으면 안 됩니다.)');
  lines.push('  **원문과 앞부분이 겹치면 안 됩니다.** 나란히 놓고 차이가 보여야 합니다.');
  lines.push('');
  lines.push('- **formal** \u2014 같은 뜻을 격식 있게. 처음 보는 사람이나 윗사람에게 쓸 말투.');
  lines.push('  축약형을 쓰지 않고 낱말을 갖춰 씁니다. **말투만 올립니다.**');
  lines.push('');
  lines.push('둘 다 실제로 쓰는 말이어야 하고, 길이는 원문과 비슷하면 됩니다.');
  lines.push('');
  lines.push('## 말투를 바꿀 영어');
  lines.push('');
  for (var i = 0; i < rows.length; i++) {
    lines.push((i + 1) + '. ' + String((rows[i] || {}).text || ''));
  }
  lines.push('');
  lines.push('## 내놓는 형식');
  lines.push('');
  lines.push('JSON 객체 하나만 출력하세요. 설명, 인사말, 코드 울타리 없이 JSON 만.');
  lines.push('');
  lines.push('{ "alts": [ { "casual": "...", "formal": "..." }, ... ] }');
  lines.push('');
  lines.push('**' + rows.length + '개**여야 하고 **순서가 그대로**여야 합니다.');
  lines.push('줄표(\u2014)와 따옴표는 쓰지 마세요. **물음표와 느낌표는 써도 됩니다** \u2014');
  lines.push('사람은 되묻고 놀랍니다. 진짜 대사 열 줄 중 하나가 물음이었습니다.');

  return lines.join('\n');
}

function buildAltsSchema(cfg) {
  return {
    type: 'object',
    properties: {
      alts: {
        type: 'array', minItems: cfg.count, maxItems: cfg.count,
        items: {
          type: 'object',
          properties: { casual: { type: 'string' }, formal: { type: 'string' } },
          required: ['casual', 'formal']
        }
      }
    },
    required: ['alts']
  };
}

function applyAlts(draft, out) {
  var rows = (draft && draft.sentences) || [];
  var got = (out && out.alts) || [];
  if (!rows.length || got.length !== rows.length) return null;

  var res = { sentences: [] };
  for (var i = 0; i < rows.length; i++) {
    var c = String((got[i] || {}).casual || '').trim();
    var f = String((got[i] || {}).formal || '').trim();
    if (!c || !f) return null;
    var row = copyRow(rows[i]);
    row.alts = [{ style: 'casual', text: c }, { style: 'formal', text: f }];
    res.sentences.push(row);
  }
  return res;
}

/* ------------------------------------------------------------------ 한국어 붙이기

   **제일 마지막이다.** 영어는 이미 확정됐고 여기서는 손댈 수 없다.
   운영자 결정 \u2014 "영어가 제일 자연스러운 문장을 만들고 그 다음에 한국어로 번역해서 보여 주면 된다.
   한국어를 계속 영어랑 비교하면서 하면 이상해진다." */

function buildKoreanPrompt(draft) {
  var rows = (draft && draft.sentences) || [];
  var lines = [];

  lines.push('아래 영어를 한국어로 옮기고, 배울 표현을 짧게 설명해 주세요.');
  lines.push('');
  lines.push('**영어는 이미 확정됐습니다. 고칠 수 없습니다.** 어색해 보여도 그대로 둡니다.');
  lines.push('여기서 할 일은 옮기는 것뿐입니다.');
  lines.push('');
  lines.push('## 한국어');
  lines.push('');
  lines.push('- 학습자는 이 한국어를 보고 영어로 말해 봅니다. **영어가 기준입니다** \u2014');
  lines.push('  영어에 없는 말을 넣거나 영어에 있는 말을 빼지 마세요.');
  lines.push('- 직역하라는 뜻은 아닙니다. **한국 사람이 그 뜻을 말할 때 쓰는 말**로 옮기세요.');
  lines.push('  번역투가 나면 실패입니다.');
  lines.push('- **애매하게 쓰지 마세요.** \'그거\', \'그런 것\' 으로 얼버무리면 무엇을 말하는지 알 수 없습니다.');
  lines.push('- 문장 수는 영어와 달라도 됩니다.');
  lines.push('- **돈은 영어와 같은 숫자로 달러로 적습니다.** 원으로 바꾸지 마세요.');
  lines.push('');
  lines.push('## 설명');
  lines.push('');
  lines.push('- 배울 만한 표현을 한국어 한두 문장으로. **별표 두 개로 감싸세요** \u2014 예: **swamped** 는 ~.');
  lines.push('  그 부분이 화면에 강조돼서 보입니다. 최소 하나는 반드시 감싸야 합니다.');
  lines.push('- 감싼 표현은 **그 문장 안에 실제로 나오는 말**이어야 합니다 (casual, formal 포함).');
  lines.push('  문장에 없는 표현을 가르치면 학습자가 어디서 나온 말인지 알 수 없습니다.');
  lines.push('');
  lines.push('## 옮길 문장');
  lines.push('');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    lines.push((i + 1) + '. ' + String(r.text || ''));
    var c = altOf(r.alts, 'casual'), f = altOf(r.alts, 'formal');
    if (c) lines.push('   casual: ' + c);
    if (f) lines.push('   formal: ' + f);
  }
  lines.push('');
  lines.push('## 내놓는 형식');
  lines.push('');
  lines.push('JSON 객체 하나만 출력하세요. 설명, 인사말, 코드 울타리 없이 JSON 만.');
  lines.push('');
  lines.push('{ "rows": [ { "ko": "...", "note": "..." }, ... ] }');
  lines.push('');
  lines.push('**' + rows.length + '개**여야 하고 **순서가 그대로**여야 합니다.');
  lines.push('줄표(\u2014)와 따옴표는 쓰지 마세요. **물음표와 느낌표는 써도 됩니다** \u2014');
  lines.push('사람은 되묻고 놀랍니다. 진짜 대사 열 줄 중 하나가 물음이었습니다.');

  return lines.join('\n');
}

function buildKoreanSchema(cfg) {
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array', minItems: cfg.count, maxItems: cfg.count,
        items: {
          type: 'object',
          properties: { ko: { type: 'string' }, note: { type: 'string' } },
          required: ['ko', 'note']
        }
      }
    },
    required: ['rows']
  };
}

function applyKorean(draft, out) {
  var rows = (draft && draft.sentences) || [];
  var got = (out && out.rows) || [];
  if (!rows.length || got.length !== rows.length) return null;

  var res = { sentences: [] };
  for (var i = 0; i < rows.length; i++) {
    var ko = String((got[i] || {}).ko || '').trim();
    var note = String((got[i] || {}).note || '').trim();
    if (!ko || !note) return null;
    var row = copyRow(rows[i]);
    row.ko = ko;
    row.note = note;
    res.sentences.push(row);
  }
  return res;
}

/* ------------------------------------------------------------------ 소리내어 읽기

   검수 단계는 볼 것이 열 가지쯤 된다 — 관용구, 한국어, alts, note, 단어 수.
   그 목록 안에서는 "이 영어를 사람이 실제로 그렇게 말하나" 가 아홉 가지 중 하나가 되어
   묻히다. 그래서 그것만 묻는 자리를 따로 둔다.

   **영어만 보여 준다.** 한국어와 상황을 같이 주면 "번역이 맞느냐" 를 보게 되고,
   그러면 어색한 영어도 "한국어를 잘 옮겼으니 괜찮다" 로 넘어간다.
   견줄 것을 아예 없애야 남는 질문이 하나가 된다 — 사람이 이렇게 말하나. */

/* 만드는 단계는 영어만 낸다. 상황과 짝지어 문장 모양으로 세운다. */
function startFromEnglish(situations, out) {
  var texts = (out && out.texts) || [];
  if (!texts.length || texts.length !== situations.length) return null;
  var res = { sentences: [] };
  for (var i = 0; i < texts.length; i++) {
    var one = String(texts[i] || '').trim();
    if (!one) return null;
    res.sentences.push({ situation: situations[i], text: one });
  }
  return res;
}

function copyRow(row) {
  var out = {};
  for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  return out;
}

function buildAloudPrompt(draft) {
  var rows = (draft && draft.sentences) || [];
  var lines = [];

  lines.push('당신은 영어가 모국어인 사람입니다. 아래 영어를 하나씩 소리내어 읽어 주세요.');
  lines.push('**듣는 사람이 앞에 앉아 있다고 생각하세요.** 혼자 읽는 것이 아닙니다.');
  lines.push('');
  lines.push('묻는 것은 둘뿐입니다.');
  lines.push('');
  lines.push('1. **사람이 실제로 이렇게 말합니까?**');
  lines.push('2. **듣는 사람이 한 번 듣고 바로 알아듣습니까?**');
  lines.push('');
  lines.push('문법을 보는 것이 아닙니다. 문법은 이미 맞습니다.');
  lines.push('뜻을 보는 것도 아닙니다. 뜻도 이미 맞습니다.');
  lines.push('**입으로 소리내어 읽었을 때 걸리는 데가 있는지**만 보세요.');
  lines.push('');
  lines.push('두 번째를 특히 보세요. **잘 쓴 글은 첫 번째만 통과하고 두 번째에서 걸립니다.**');
  lines.push('글은 걸리면 눈으로 다시 읽으면 되지만 말은 한 번뿐입니다.');
  lines.push('한 박자 생각해야 무슨 말인지 알겠으면 그건 잘 쓴 글이지 사람이 하는 말이 아닙니다.');
  lines.push('');
  lines.push('이런 것이 걸립니다.');
  lines.push('');
  lines.push('- 할 말이 끝났는데 한 마디가 더 붙어 있다');
  lines.push('- 뒷부분이 앞부분에 억지로 매달려 있다');
  lines.push('- 무엇을 가리키는지 흐린 낱말이 있다');
  lines.push('- 글로 쓰면 되는데 입으로는 안 하는 말이다');
  lines.push('- **문장을 잇는 말이 빠져서 뒷줄이 뚝 떨어진다.** 지금 제일 흔한 문제입니다.');
  lines.push('  사람은 so, but, and then, because 로 이어 말합니다. 그걸 빼고 나란히 붙여 놓으면');
  lines.push('  듣는 사람이 그 사이를 짐작해야 합니다 \u2014 그게 글입니다. 실제로 그렇게 나갔습니다.');
  lines.push('  (I got to the gym and every treadmill was taken. I could have waited. I drove home.');
  lines.push('   왜 그냥 왔는지가 빠져서 마지막 줄이 갑자기 튀어나옵니다.');
  lines.push('   말로는 I could have waited, but I just drove home. 이라고 합니다.)');
  lines.push('- **왜 그런지를 말하지 않고 짐작하게 둔다.** 이것도 실제로 나갔습니다.');
  lines.push('  (My cat sleeps on my chest every night and I have stopped moving her.');
  lines.push('   I wake up at four with my arm asleep and wait until she moves.');
  lines.push('   팔이 왜 저린지, 왜 그냥 기다리는지가 빠져서 듣는 사람이 이야기를 지어내야 합니다.)');
  lines.push('- **뜻을 마지막까지 아껴 두었다가 끝에서 터뜨린다.** 그건 글이 하는 일입니다.');
  lines.push('  말은 할 말을 앞에 놓고 뒤에서 풀어 줍니다.');
  lines.push('- 뜻은 맞지만 그 자리에서 원어민이 고르지 않을 낱말이다');
  lines.push('- **다른 나라 것을 영어 낱말로 옮겨 놓았다.** 이건 특히 잘 보세요.');
  lines.push('  뜻은 통하는데 영어권에 그런 것이 없어서 어리둥절해지는 대목입니다.');
  lines.push('  (한국의 회식 1차 · 2차를 first round, second round 로 옮겨 놓은 적이 있습니다.');
  lines.push('   영어의 round 는 술을 한 차례 돌리는 것이지 자리를 옮기는 것이 아닙니다.)');
  lines.push('  **이 영어만 읽는 사람이 무슨 말인지 바로 아는가**로 가늠하세요.');
  lines.push('');
  lines.push('**걸리는 데가 없으면 그대로 두세요.** 고칠 것이 없는데 고치면 더 나빠집니다.');
  lines.push('고칠 때는 **뜻을 바꾸지 말고**, 길이도 크게 늘리지 마세요.');
  lines.push('다만 빠진 이어 주는 말을 도로 넣는 것은 늘리는 것이 아닙니다 \u2014 그게 원래 말입니다.');
  lines.push('더 낫게 만드는 자리가 아니라 **걸리는 데를 없애는 자리**입니다.');
  lines.push('');
  lines.push('## 읽을 영어');
  lines.push('');
  for (var i = 0; i < rows.length; i++) {
    lines.push((i + 1) + '. ' + String((rows[i] || {}).text || ''));
  }
  lines.push('');
  lines.push('## 내놓는 형식');
  lines.push('');
  lines.push('JSON 객체 하나만 출력하세요. 설명, 인사말, 코드 울타리 없이 JSON 만.');
  lines.push('');
  lines.push('{');
  lines.push('  "texts": ["1번 영어", "2번 영어", ...],');
  lines.push('  "changed": ["몇 번을 왜 고쳤는지 한국어로 한 줄씩. 안 고쳤으면 빈 목록"]');
  lines.push('}');
  lines.push('');
  lines.push('"texts" 는 **' + rows.length + '개**여야 하고 **순서가 그대로**여야 합니다.');
  lines.push('안 고친 것은 받은 그대로 넣으세요.');
  lines.push('줄표(\u2014)와 따옴표는 쓰지 마세요. **물음표와 느낌표는 써도 됩니다** \u2014');
  lines.push('사람은 되묻고 놀랍니다. 진짜 대사 열 줄 중 하나가 물음이었습니다.');

  return lines.join('\n');
}

function buildAloudSchema(cfg) {
  return {
    type: 'object',
    properties: {
      texts: {
        type: 'array', minItems: cfg.count, maxItems: cfg.count,
        items: { type: 'string' }
      },
      changed: { type: 'array', items: { type: 'string' } }
    },
    required: ['texts']
  };
}

/* 읽고 고친 영어를 초안에 도로 끼운다. 개수나 순서가 어긋나면 손대지 않는다 \u2014
   엉뚱한 문장에 엉뚱한 영어가 붙는 것보다 초안 그대로 나가는 편이 낫다. */
function applyAloud(draft, aloud) {
  var rows = (draft && draft.sentences) || [];
  var texts = (aloud && aloud.texts) || [];
  if (!rows.length || texts.length !== rows.length) return null;

  var out = { sentences: [] }, changed = 0;
  for (var i = 0; i < rows.length; i++) {
    var one = String(texts[i] || '').trim();
    if (!one) return null;
    var row = copyRow(rows[i]);
    if (one !== String(row.text || '').trim()) changed++;
    row.text = one;
    out.sentences.push(row);
  }
  out.aloudChanged = changed;
  return out;
}

/* ------------------------------------------------------------------ 다시 보기

   한 번 만든 것을 그대로 내보내면 틀린 관용구가 그대로 나간다. 실제로 겪었다 —
   "hit the spot"(음식), "call it a day"(일 끝내기)를 엉뚱한 자리에 쓴 채로 올라갔다.
   그래서 만든 것을 한 번 더 읽히고 고쳐서 내보낸다. 값이 안 드는 일이라 안 할 이유가 없다. */

function buildReviewPrompt(draft, cfg) {
  var lines = [];

  lines.push('당신은 영어 원어민이자 한국인 학습자용 교재를 검수하는 사람입니다.');
  lines.push('아래는 오늘 학습자에게 나갈 연습 문장 초안입니다. 그대로 내보내기 전에 검수해 주세요.');
  lines.push('');
  lines.push('학습자는 "ko"(한국어)를 보고 "text"(영어)로 옮겨 말하는 연습을 합니다.');
  lines.push('"alts" 는 같은 말을 말투만 바꿔 하는 법이고, "note" 는 배울 표현 설명입니다.');
  lines.push('');
  lines.push('**"text" 는 이미 원어민이 소리내어 읽고 고친 것입니다.** 걸리는 데는 그때 없앴습니다.');
  lines.push('그러니 "text" 를 다시 손보려 하지 말고, **나머지가 "text" 와 맞는지**를 보세요 \u2014');
  lines.push('한국어가 그 영어의 뜻인지, alts 가 그 영어의 말투를 바꾼 것인지,');
  lines.push('note 가 그 영어에 실제로 나오는 표현을 짚는지. 영어가 고쳐졌으면 나머지도 따라 고칩니다.');
  lines.push('');
  lines.push('## 반드시 볼 것');
  lines.push('');
  lines.push('1. **관용구를 뜻에 맞게 썼는가.** 이게 제일 중요합니다.');
  lines.push('   원어민이 그 자리에서 그 표현을 쓰지 않으면 틀린 것입니다.');
  lines.push('   (전에 "hit the spot" 을 음식이 아닌 곳에, "call it a day" 를 일과 무관한 곳에');
  lines.push('    쓴 채로 나간 적이 있습니다. 이런 것을 잡아 주세요.)');
  lines.push('2. **소리내어 읽었을 때 어색하지 않은가.** 글로 쓴 문장 같으면 고칩니다.');
  lines.push('   특히 **번역체 냄새**를 보세요. 한국어를 그대로 옮긴 티가 나면 영어를 새로 씁니다.');
  lines.push('   한국어와 1:1로 안 맞아도 됩니다. 영어가 자연스러운 것이 먼저입니다.');
  lines.push('2-1. **규칙을 채우려고 늘려 쓴 데가 있는가.** 이게 제일 흔한 문제입니다.');
  lines.push('     할 말이 끝났는데 한 마디를 더 붙였으면 **그 마디를 잘라 내세요.**');
  lines.push('     문장이 짧아지는 것은 괜찮습니다. 한 문장으로 끝나도 됩니다.');
  lines.push('     쉼표로 계속 이었으면 그때만 나눕니다.');
  lines.push('2-4. **원어민이 그 자리에서 안 쓰는 낱말이 있는가.** (예: 배달 다시 시키기 = reorder 가 아니라 order again)');
  lines.push('2-6. **돈이 달러로 적혀 있는가.** 원 단위는 달러로 바꿉니다.');
  lines.push('     **한국어의 숫자도 영어와 같아야 합니다** \u2014 한쪽만 바꾸면 안 됩니다.');
  lines.push('2-5. **두 가지로 읽히는 대목이 있는가.** 문법이 맞아도 순간 헷갈리면 고칩니다.');
  lines.push('3. **casual 이 text 와 충분히 다른가.** 앞부분이 겹치면 고칩니다.');
  lines.push('   캐주얼은 관용구를 넣는 것이 아니라 더 짧고 축약된 구어입니다.');
  lines.push('4. **formal 이 뜻을 바꾸지 않았는가.** 말투만 올려야 하고,');
  lines.push('   내용을 눅이거나 빼먹으면 안 됩니다.');
  lines.push('5. **한국어가 번역투가 아닌가.** 한국 사람이 친구에게 하듯 자연스러워야 합니다.');
  lines.push('6. **note 에서 별표로 감싼 표현이 위 문장들 안에 실제로 나오는가.**');
  lines.push('   없는 표현을 가르치면 안 됩니다. 감싼 것이 하나도 없어도 안 됩니다.');
  lines.push('7. **"text" 가 ' + cfg.maxWords + ' 단어를 넘지 않는가.** 넘으면 줄입니다.');
  lines.push('   **하한은 없습니다. 짧다고 늘리지 마세요** \u2014 진짜 말은 열에 아홉이 20 단어 이하입니다.');
  lines.push('8. 줄표(\u2014)와 따옴표를 쓰지 않았는가. 물음표와 느낌표는 써도 됩니다.');
  lines.push('');
  lines.push('## 어떻게 할 것인가');
  lines.push('');
  lines.push('**지적만 하지 말고 직접 고쳐서 내놓으세요.** 고친 최종본을 "sentences" 에 담고,');
  lines.push('무엇을 왜 고쳤는지를 "problems" 에 한국어 한 줄씩 적으세요.');
  lines.push('고칠 것이 없으면 "problems" 를 빈 목록으로 두고 "sentences" 는 그대로 돌려주세요.');
  lines.push('문장 개수(' + cfg.count + '개)와 "situation" 은 바꾸지 마세요.');
  lines.push('');
  lines.push('**의심스러우면 고치는 쪽으로 하세요.** 어설픈 표현이 나가는 것보다 낫습니다.');
  lines.push('');
  lines.push('## 검수할 초안');
  lines.push('');
  lines.push(JSON.stringify({ sentences: draft.sentences }, null, 2));
  lines.push('');
  lines.push('JSON 객체 하나만 출력하세요. 설명, 인사말, 코드 울타리 없이 JSON 만.');

  return lines.join('\n');
}


/* alts 에 어떤 말투가 들어 있는지. 모양이 틀리면 null */
function altStyles(alts) {
  if (!Array.isArray(alts) || alts.length !== 2) return null;
  var seen = {};
  for (var i = 0; i < alts.length; i++) {
    var a = alts[i];
    if (!a || typeof a !== 'object') return null;
    if (!a.text || !String(a.text).trim()) return null;
    if (a.style !== 'casual' && a.style !== 'formal') return null;
    seen[a.style] = true;
  }
  return seen;
}

/* 옛 파일은 alts 가 그냥 글 목록이었다. 그때 것도 읽히게 둔다 */
function normalizeAlts(alts) {
  var out = [];
  for (var i = 0; i < (alts || []).length; i++) {
    var a = alts[i];
    if (typeof a === 'string') out.push({ style: 'casual', text: a.trim() });
    else if (a && a.text) out.push({ style: a.style || 'casual', text: String(a.text).trim() });
  }
  return out;
}

/* note 에서 **로 감싼 대목들 */
function highlighted(note) {
  var out = [], m;
  var re = /\*\*([^*]+)\*\*/g;
  while ((m = re.exec(String(note || '')))) {
    var one = m[1].trim();
    if (one) out.push(one);
  }
  return out;
}

function bare(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* 강조한 표현 중 하나라도 문장이나 다른 표현 안에 실제로 나오는지 */
function keysAppear(keys, row) {
  var hay = bare(row.text);
  for (var a = 0; a < (row.alts || []).length; a++) {
    var alt = row.alts[a];
    hay += ' ' + bare(typeof alt === 'string' ? alt : (alt && alt.text));
  }
  for (var k = 0; k < keys.length; k++) {
    var key = bare(keys[k]).replace(/ ~$/, '').trim();
    if (key && hay.indexOf(key) >= 0) return true;
  }
  return false;
}

function altOf(alts, style) {
  for (var i = 0; i < (alts || []).length; i++) {
    if (alts[i] && alts[i].style === style) return alts[i].text;
  }
  return '';
}

/* 앞 네 낱말이 같으면 같은 문장으로 본다 */
function sameOpening(a, b) {
  if (!a || !b) return false;
  var x = bare(a).split(' ').slice(0, 4).join(' ');
  var y = bare(b).split(' ').slice(0, 4).join(' ');
  return !!x && x === y;
}

/* 문장을 마침표·물음표·느낌표로 나눈다 */
function sentencesOf(text) {
  var parts = String(text || '').split(/[.!?]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].replace(/\s/g, '')) out.push(parts[i]);
  }
  return out;
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

    // 길이는 상한만 본다. 하한을 두었더니 진짜 말이 사는 자리(8~11 단어)를
    // 통째로 막고 있었다 — 진짜 대사 1,458줄 중 58%가 12 단어 미만이었다.
    // 외워서 따라 말해야 하므로 너무 긴 것만 막는다 (운영자 결정)
    var n = wordCount(r.text);
    if (!n) {
      problems.push(at + '영어 문장이 비었습니다.');
    } else if (n > cfg.maxWords) {
      problems.push(at + '영어 문장이 ' + n + ' 단어입니다 ('
        + cfg.maxWords + ' 단어를 넘으면 외워서 따라 말할 수 없습니다).');
    }

    var key = String(r.text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (key && seen[key]) problems.push(at + '앞 문장과 같습니다.');
    seen[key] = true;

    // 말투를 바꾼 표현은 캐주얼·포멀 하나씩 있어야 한다
    var styles = altStyles(r.alts);
    if (!styles) {
      problems.push(at + '다르게 말하는 법(alts)이 없거나 모양이 다릅니다.');
    } else {
      if (!styles.casual) problems.push(at + 'casual 표현이 없습니다.');
      if (!styles.formal) problems.push(at + 'formal 표현이 없습니다.');
    }

    // 강조할 표현이 하나도 없으면 note 가 밋밋해진다
    var keys = highlighted(r.note);
    if (r.note && !keys.length) {
      problems.push(at + 'note 에 **로 감싼 표현이 없습니다.');
    } else if (keys.length && !keysAppear(keys, r)) {
      // 문장에 없는 표현을 가르치면 어디서 나온 말인지 알 수 없다
      problems.push(at + 'note 에서 강조한 표현이 문장에 하나도 나오지 않습니다.');
    }

    // 캐주얼이 정답과 앞부분이 같으면 나란히 놓아도 차이가 안 보인다
    if (styles && sameOpening(r.text, altOf(r.alts, 'casual'))) {
      problems.push(at + 'casual 이 정답과 앞부분이 같습니다.');
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
  // 검수에서 무엇을 고쳤는지 남긴다. 앱은 안 읽는다 — 나중에 왜 이렇게 됐는지 볼 때 쓴다
  if (parsed.problems && parsed.problems.length) out.reviewed = parsed.problems;
  for (var i = 0; i < parsed.sentences.length; i++) {
    var r = parsed.sentences[i];
    out.sentences.push({
      i: i,
      ko: String(r.ko).trim(),
      text: String(r.text).trim(),
      alts: normalizeAlts(r.alts),
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

/* ------------------------------------------------------------------ 묶음 (set)

   문장 묶음은 **날짜에 묶여 있지 않다.** 만든 날이 언제든 창고에 쌓아 두고,
   앱이 사람이 공부하러 온 날에 하나씩 꺼내 쓴다.

   그래야 며칠 안 해도 묶음이 버려지지 않고, "내가 언제 공부했는지" 가
   만든 날이 아니라 실제로 한 날로 남는다 (운영자 결정).

   묶음 번호는 한번 매기면 바뀌지 않는다 — 문장카드가 이 번호를 가리킨다. */

function key(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function setsFile(pid) { return path.join(DAILY, pid, 'sets.json'); }

function listSets(pid) { return readJSON(setsFile(pid), []); }

/* 저장소에 실제로 있는 묶음 번호. 번호순.

   sets.json 은 **앱이 나눠 줄 목록**이라 손으로 줄일 수 있다 (옛 묶음을 그만 내보낼 때).
   그런데 번호 매기기와 겹침 피하기가 그 목록을 보면, 목록을 줄이는 순간
   번호를 다시 쓰거나(파일을 덮어쓴다) 피할 것을 잊는다. 그래서 이쪽은 파일을 본다. */
function allSetIds(pid) {
  var dir = path.join(DAILY, pid, 'sets');
  var names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  var out = [];
  for (var i = 0; i < names.length; i++) {
    if (/^s\d+\.json$/.test(names[i])) out.push(names[i].replace(/\.json$/, ''));
  }
  out.sort();
  return out;
}

function nextSetId(pid) {
  var ids = allSetIds(pid);
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var n = parseInt(String(ids[i]).replace(/^s/, ''), 10);
    if (n > max) max = n;
  }
  var next = max + 1;
  return 's' + (next < 100 ? ('00' + next).slice(-3) : String(next));
}

/* 이미 있는 묶음의 문장과 겹치는지. 같은 문장을 또 내보내면 안 된다 */
function knownTexts(pid, days) {
  var ids = allSetIds(pid);
  var seen = {};
  var from = Math.max(0, ids.length - (days || 40));
  for (var i = from; i < ids.length; i++) {
    var one = readJSON(path.join(DAILY, pid, 'sets', ids[i] + '.json'), null);
    if (!one || !one.sentences) continue;
    for (var s = 0; s < one.sentences.length; s++) seen[key(one.sentences[s].text)] = true;
  }
  return seen;
}

function toSetFile(parsed, id, madeAt) {
  var out = {
    setId: id,
    videoId: 'daily-' + id,
    title: 'Set ' + String(id).replace(/^s0*/, ''),
    madeAt: madeAt,
    source: 'daily',
    sentences: []
  };
  for (var i = 0; i < parsed.sentences.length; i++) {
    var r = parsed.sentences[i];
    out.sentences.push({
      i: i,
      ko: String(r.ko).trim(),
      text: String(r.text).trim(),
      alts: normalizeAlts(r.alts),
      note: String(r.note).trim(),
      situation: String(r.situation).trim(),
      start: null, end: null, recording: null
    });
  }
  if (parsed.problems && parsed.problems.length) out.reviewed = parsed.problems;
  return out;
}

function saveSet(parsed, pids, madeAt) {
  var written = [];
  var id = null;
  for (var p = 0; p < pids.length; p++) {
    id = id || nextSetId(pids[p]);
    var set = toSetFile(parsed, id, madeAt);
    writeJSON(path.join(DAILY, pids[p], 'sets', id + '.json'), set);

    var rows = listSets(pids[p]);
    var keep = [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id !== id) keep.push(rows[i]);
    keep.push({ id: id, count: set.sentences.length, madeAt: madeAt });
    keep.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    writeJSON(setsFile(pids[p]), keep);
    written.push(pids[p]);
  }
  return { id: id, profiles: written, count: parsed.sentences.length };
}

module.exports = {
  ROOT: ROOT, DAILY: DAILY,
  readJSON: readJSON, writeJSON: writeJSON,
  config: config, profileIds: profileIds, todayKST: todayKST,
  recentSituations: recentSituations, pickSituations: pickSituations,
  shuffle: shuffle, vocabulary: vocabulary, buildPrompt: buildPrompt,
  realLines: realLines,
  recentTexts: recentTexts,
  extractJSON: extractJSON, unwrap: unwrap,
  buildSchema: buildSchema, buildReviewSchema: buildReviewSchema,
  buildReviewPrompt: buildReviewPrompt,
  buildAloudPrompt: buildAloudPrompt, buildAloudSchema: buildAloudSchema,
  applyAloud: applyAloud, startFromEnglish: startFromEnglish,
  buildAltsPrompt: buildAltsPrompt, buildAltsSchema: buildAltsSchema, applyAlts: applyAlts,
  buildKoreanPrompt: buildKoreanPrompt, buildKoreanSchema: buildKoreanSchema,
  applyKorean: applyKorean,
  altStyles: altStyles, normalizeAlts: normalizeAlts,
  sentencesOf: sentencesOf,
  highlighted: highlighted, keysAppear: keysAppear, sameOpening: sameOpening,
  wordCount: wordCount, validate: validate,
  toDayFile: toDayFile, updateIndex: updateIndex,
  listSets: listSets, allSetIds: allSetIds, nextSetId: nextSetId, knownTexts: knownTexts,
  toSetFile: toSetFile, saveSet: saveSet, key: key
};
