/* 하루 다섯 문장을 만드는 쪽의 검사. 네트워크도 파일 쓰기도 필요 없다.
   돌리는 법:  node tools/test_daily.js */
'use strict';

var daily = require('./daily');

var failed = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  OK   ' : '  실패 ') + name);
  if (!ok) {
    console.log('       받은 값:', JSON.stringify(got));
    console.log('       기대값:', JSON.stringify(want));
    failed++;
  }
}

var CFG = { count: 2, minWords: 5, maxWords: 12 };

function row(over) {
  var base = {
    situation: '회의에서 반대하기',
    ko: '그 일정은 아무래도 무리라고 봅니다.',
    text: 'That deadline is tough. I think we need more time.',
    alts: [
      { style: 'casual', text: 'That timeline feels rough to me, honestly.' },
      { style: 'formal', text: 'That timeline appears unrealistic to me.' }
    ],
    note: '**deadline** 은 마감일입니다. **honestly** 를 붙이면 조심스러워집니다.'
  };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

console.log('\nJSON 꺼내기 — Claude 가 앞뒤에 말을 붙여도 읽어야 한다');
check('그냥 JSON', daily.extractJSON('{"a":1}'), { a: 1 });
check('코드 울타리', daily.extractJSON('```json\n{"a":1}\n```'), { a: 1 });
check('울타리에 json 이 없어도', daily.extractJSON('```\n{"a":1}\n```'), { a: 1 });
check('앞뒤에 인사말', daily.extractJSON('네, 만들었습니다.\n{"a":1}\n도움이 되길!'), { a: 1 });
check('안에 중괄호가 또 있어도',
  daily.extractJSON('말\n{"s":[{"b":2}]}\n끝'), { s: [{ b: 2 }] });

var threw = false;
try { daily.extractJSON('JSON 이 없습니다'); } catch (e) { threw = true; }
check('JSON 이 없으면 예외', threw, true);

console.log('\n겉봉투 벗기기 — CLI 가 --output-format json 으로 싸서 준다');
check('구조화 출력 봉투',
  daily.unwrap({ session_id: 'x', structured_output: { sentences: [1] } }), { sentences: [1] });
check('글로 온 결과 봉투',
  daily.unwrap({ session_id: 'x', result: '```json\n{"sentences":[2]}\n```' }), { sentences: [2] });
check('봉투가 없으면 그대로',
  daily.unwrap({ sentences: [3] }), { sentences: [3] });

console.log('\n답 형식 — 칸이 비는 것은 이걸로 막는다');
var schema = daily.buildSchema({ count: 5 });
check('개수를 못 박는다',
  [schema.properties.sentences.minItems, schema.properties.sentences.maxItems], [5, 5]);
check('다섯 칸 모두 필수',
  schema.properties.sentences.items.required.sort(),
  ['alts', 'ko', 'note', 'situation', 'text']);
check('다르게 말하는 법은 정확히 두 개',
  [schema.properties.sentences.items.properties.alts.minItems,
   schema.properties.sentences.items.properties.alts.maxItems], [2, 2]);
check('말투는 캐주얼 아니면 포멀',
  schema.properties.sentences.items.properties.alts.items.properties.style['enum'],
  ['casual', 'formal']);

console.log('\n단어 세기');
check('보통 문장', daily.wordCount('I think that is fine.'), 5);
check('빈 값은 0', daily.wordCount(''), 0);
check('공백만 있어도 0', daily.wordCount('   '), 0);
check('줄바꿈·연속공백도 하나로', daily.wordCount('one  two\nthree'), 3);

console.log('\n검사 — 조건에 걸리면 그날 파일을 아예 안 쓴다');
check('멀쩡하면 문제 없음', daily.validate({ sentences: [row(), row({
  text: 'She would have called us. The meeting ran late again.',
  ko: '회의가 일찍 끝났으면 연락했을 겁니다.'
})] }, CFG), []);

check('sentences 가 없으면', daily.validate({}, CFG), ['sentences 목록이 없습니다.']);

check('개수가 모자라면',
  daily.validate({ sentences: [row()] }, CFG),
  ['문장이 2개여야 하는데 1개입니다.']);

check('문장이 짧으면 잡는다',
  daily.validate({ sentences: [row({ text: 'Too short.' })] }, CFG).slice(1)[0],
  '문장 1: 영어 문장이 2 단어입니다 (5~12 이어야 합니다).');

check('문장이 길면 잡는다',
  daily.validate({ sentences: [row({
    text: 'one two three four five. six seven eight nine ten eleven twelve thirteen.'
  })] }, CFG).slice(1),
  ['문장 1: 영어 문장이 13 단어입니다 (5~12 이어야 합니다).']);

check('한국어가 비면 잡는다',
  daily.validate({ sentences: [row({ ko: '  ' })] }, CFG).slice(1),
  ['문장 1: 한국어가 비었습니다.']);

check('설명이 비면 잡는다',
  daily.validate({ sentences: [row({ note: '' })] }, CFG).slice(1),
  ['문장 1: 설명이 비었습니다.']);

check('다르게 말하는 법이 없으면 잡는다',
  daily.validate({ sentences: [row({ alts: [] })] }, CFG).slice(1),
  ['문장 1: 다르게 말하는 법(alts)이 없거나 모양이 다릅니다.']);

check('캐주얼만 두 개면 잡는다',
  daily.validate({ sentences: [row({ alts: [
    { style: 'casual', text: 'one' }, { style: 'casual', text: 'two' }] })] }, CFG).slice(1),
  ['문장 1: formal 표현이 없습니다.']);

check('포멀만 두 개면 잡는다',
  daily.validate({ sentences: [row({ alts: [
    { style: 'formal', text: 'one' }, { style: 'formal', text: 'two' }] })] }, CFG).slice(1),
  ['문장 1: casual 표현이 없습니다.']);

check('세 개면 잡는다',
  daily.validate({ sentences: [row({ alts: [
    { style: 'casual', text: 'a' }, { style: 'formal', text: 'b' },
    { style: 'casual', text: 'c' }] })] }, CFG).slice(1),
  ['문장 1: 다르게 말하는 법(alts)이 없거나 모양이 다릅니다.']);

check('말투 딱지가 이상하면 잡는다',
  daily.validate({ sentences: [row({ alts: [
    { style: 'polite', text: 'a' }, { style: 'formal', text: 'b' }] })] }, CFG).slice(1),
  ['문장 1: 다르게 말하는 법(alts)이 없거나 모양이 다릅니다.']);

check('note 에 강조가 하나도 없으면 잡는다',
  daily.validate({ sentences: [row({ note: '강조가 없는 설명입니다.' })] }, CFG).slice(1),
  ['문장 1: note 에 **로 감싼 표현이 없습니다.']);

check('강조가 하나라도 있으면 통과',
  daily.validate({ sentences: [row({ note: '**tough** 는 힘들다는 뜻입니다.' }), row({
    text: 'She would have called us. The meeting ran late again.',
    ko: '연락했을 거야. 회의가 또 늦게 끝났어.' })] }, CFG), []);

check('같은 문장이 두 번 나오면 잡는다',
  daily.validate({ sentences: [row(), row()] }, CFG),
  ['문장 2: 앞 문장과 같습니다.']);

check('대소문자·문장부호만 다른 중복도 잡는다',
  daily.validate({ sentences: [row(), row({
    text: 'THAT DEADLINE IS TOUGH! I THINK WE NEED MORE TIME!!'
  })] }, CFG),
  ['문장 2: 앞 문장과 같습니다.']);

console.log('\nnote 의 강조 — 문장에 없는 표현을 가르치면 안 된다');
check('별표로 감싼 대목을 뽑는다',
  daily.highlighted('**cave** 는 무너지다. **hold out** 은 버티다.'), ['cave', 'hold out']);
check('감싼 것이 없으면 빈 목록', daily.highlighted('강조가 없습니다.'), []);
check('별표 짝이 안 맞으면 무시', daily.highlighted('**cave 는 무너지다.'), []);

check('강조한 표현이 정답에 있으면 통과',
  daily.keysAppear(['deadline'], { text: 'I think that deadline is tough.', alts: [] }), true);
check('캐주얼 쪽에 있어도 통과',
  daily.keysAppear(['rough'], { text: 'I think that deadline is tough.',
    alts: [{ style: 'casual', text: 'That feels rough.' }] }), true);
check('낱말 꼴이 달라도 찾는다 (cave / caved)',
  daily.keysAppear(['cave'], { text: 'I caved after three days.', alts: [] }), true);
check('물결표는 떼고 찾는다',
  daily.keysAppear(['tempted to ~'], { text: "I'm tempted to just eat this.", alts: [] }), true);
check('어디에도 없으면 걸린다',
  daily.keysAppear(['swamped'], { text: 'I think that deadline is tough.', alts: [] }), false);

check('없는 표현을 강조하면 검사에서 잡는다',
  daily.validate({ sentences: [row({ note: '**swamped** 는 바쁘다는 뜻입니다.' })] }, CFG).slice(1),
  ['문장 1: note 에서 강조한 표현이 문장에 하나도 나오지 않습니다.']);

console.log('\n번역체의 자국 — 쉼표 더미, 한 문장, 대명사 투성이');
check('한 문장에 쉼표 셋이면 걸린다',
  daily.commaHeavy('I went, I saw, I came, and I left.'), true);
check('쉼표 둘까지는 괜찮다', daily.commaHeavy('I went, I saw, and I left.'), false);
check('문장을 나누면 괜찮다',
  daily.commaHeavy('I went, I saw. I came, and I left.'), false);

check('문장 수를 센다',
  daily.sentencesOf('One thing. Two things! Three?').length, 3);
check('마침표 뒤 빈 조각은 안 센다', daily.sentencesOf('Only one.').length, 1);

check('대명사를 센다',
  daily.vagueCount('It was that thing, and this is it.'), 5);
check('구체적이면 적게 나온다',
  daily.vagueCount('I ordered chicken and they sent pasta.'), 0);

// 한 문장으로 끝나는 것은 이제 통과다 — 짧게 끝나는 것이 자연스러울 때가 있다
check('한 문장뿐이어도 통과한다',
  daily.validate({ sentences: [row({ text: 'That deadline is really tough for us.' })] }, CFG).slice(1),
  []);

check('쉼표가 많으면 잡는다',
  daily.validate({ sentences: [row({
    text: 'I went, I saw, I came, and I left today.' })] }, CFG).slice(1),
  ['문장 1: 한 문장에 쉼표가 너무 많습니다. 문장을 나누세요.']);

check('대명사가 다섯을 넘으면 잡는다',
  daily.validate({ sentences: [row({
    text: 'It was that thing. This is it, with that among these too.' })] }, CFG).slice(1),
  ['문장 1: it/this/that 이 7번 나옵니다. 구체적인 것을 넣으세요.']);

// 자연스러움은 글자 모양으로 못 잡는다. 'and that was that' 은 제자리에 쓰면 멀쩡한 말이고
// 'and that helps nobody' 가 나쁜 것은 시제가 안 맞아서지 그 글자 때문이 아니다.
// 기계는 그 둘을 구별하지 못하므로 이 검사는 두지 않는다 — 소리내어 읽는 단계가 맡는다
check('and that 이 들어갔다고 걸리지 않는다',
  daily.validate({ sentences: [row({
    text: 'We left the party early, and that was that.' })] }, CFG).slice(1), []);

console.log('\ncasual 이 정답과 겹치는지');
check('앞 네 낱말이 같으면 같은 문장으로 본다',
  daily.sameOpening('Part of me wants to move now.', 'Part of me wants to stay.'), true);
check('앞부분이 다르면 통과',
  daily.sameOpening('Part of me wants to move.', 'I keep thinking about moving.'), false);
check('대소문자와 문장부호는 무시', daily.sameOpening('I am, honestly, fine.', 'i am honestly fine'), true);
check('한쪽이 비면 false', daily.sameOpening('', 'anything'), false);

check('겹치면 검사에서 잡는다',
  daily.validate({ sentences: [row({ alts: [
    { style: 'casual', text: 'That deadline is tough for me. No way.' },
    { style: 'formal', text: 'That timeline appears unrealistic to me.' }] })] }, CFG).slice(1),
  ['문장 1: casual 이 정답과 앞부분이 같습니다.']);

console.log('\n길이가 다 비슷하면 잡는다');
var SPREAD = { count: 3, minWords: 5, maxWords: 12, shortWords: 8, shortCount: 2 };
function len(words) {   // 지정한 낱말 수로 두 문장짜리를 만든다
  var out = [];
  for (var i = 0; i < words - 1; i++) out.push('word');
  return 'Yes. ' + out.join(' ') + '.';
}
check('둘이 짧으면 통과',
  daily.validate({ sentences: [
    row({ text: len(7) }), row({ text: len(8) }), row({ text: len(12) })] }, SPREAD)
    .filter(function (p) { return p.indexOf('단어 이하') >= 0; }), []);
check('하나만 짧으면 잡는다',
  daily.validate({ sentences: [
    row({ text: len(7) }), row({ text: len(11) }), row({ text: len(12) })] }, SPREAD)
    .filter(function (p) { return p.indexOf('단어 이하') >= 0; }),
  ['8 단어 이하인 문장이 1개뿐입니다 (2개 이상이어야 합니다). 길이를 서로 다르게 하세요.']);
check('설정에 없으면 이 검사를 안 한다',
  daily.validate({ sentences: [row({ text: len(7) })] }, { count: 1, minWords: 5, maxWords: 12 })
    .filter(function (p) { return p.indexOf('단어 이하') >= 0; }), []);

console.log('\n검수 — 만든 것을 한 번 더 읽히는 단계');
var rev = daily.buildReviewPrompt({ sentences: [row()] }, { count: 5, minWords: 20, maxWords: 35 });
check('초안이 지시문에 담긴다', rev.indexOf('That deadline is tough') >= 0, true);
check('관용구 오용을 보라고 한다', rev.indexOf('hit the spot') >= 0, true);
check('지적만 말고 고치라고 한다', rev.indexOf('직접 고쳐서 내놓으세요') >= 0, true);
check('개수를 바꾸지 말라고 한다', rev.indexOf('문장 개수(5개)') >= 0, true);
check('돈을 달러로 보라고 한다', rev.indexOf('돈이 달러로 적혀 있는가') >= 0, true);
check('짧은 것을 늘리지 말라고 한다', rev.indexOf('짧은 것을 늘리지 마세요') >= 0, true);
check('늘려 쓴 데를 잘라 내라고 한다', rev.indexOf('그 마디를 잘라 내세요') >= 0, true);
check('아래쪽에 붙었다고 늘리지 말라고 한다',
  rev.indexOf('늘리지 마세요') >= 0, true);
// 영어는 앞 단계에서 이미 읽혔다. 여기서는 나머지를 영어에 맞추는 것이 일이다
check('영어를 다시 손보지 말라고 한다',
  rev.indexOf('"text" 를 다시 손보려 하지 말고') >= 0, true);
check('casual 과 견주라고 하지 않는다',
  rev.indexOf('casual 쪽이 더 사람 말 같으면') >= 0, false);

console.log('\n소리내어 읽기 — 영어만 따로 떼어 읽히는 단계');
var draft = { sentences: [
  { text: 'I did nothing all weekend.', ko: '주말에 아무것도 안 했어.', situation: '가',
    note: '**nothing** 은 아무것도 아니라는 뜻입니다.',
    alts: [{ style: 'casual', text: 'Zero plans. Zero regrets.' },
           { style: 'formal', text: 'I rested for the entire weekend.' }] },
  { text: 'The chair still has not shown up.', ko: '의자가 아직도 안 왔어.', situation: '나',
    note: '**shown up** 은 나타났다는 뜻입니다.', alts: [] }] };
var al = daily.buildAloudPrompt(draft);
check('영어가 들어간다', al.indexOf('I did nothing all weekend.') >= 0, true);
check('한국어는 안 보여 준다', al.indexOf('주말에 아무것도 안 했어') >= 0, false);
check('상황도 안 보여 준다', al.indexOf('situation') >= 0, false);
check('alts 도 안 보여 준다', al.indexOf('Zero regrets') >= 0, false);
check('묻는 것이 하나뿐이라고 한다',
  al.indexOf('사람이 실제로 이렇게 말합니까') >= 0, true);
check('걸릴 데가 없으면 두라고 한다', al.indexOf('그대로 두세요') >= 0, true);
check('개수를 못 박는다', al.indexOf('**2개**') >= 0, true);
check('다른 나라 것을 옮겨 놓았는지 보라고 한다',
  al.indexOf('다른 나라 것을 영어 낱말로 옮겨 놓았다') >= 0, true);
check('이 영어만 읽는 사람 기준으로 가늠하라고 한다',
  al.indexOf('이 영어만 읽는 사람이 무슨 말인지 바로 아는가') >= 0, true);

var alSchema = daily.buildAloudSchema({ count: 5 });
check('영어만 돌려받는다', alSchema.required, ['texts']);
check('개수를 형식으로도 못 박는다',
  [alSchema.properties.texts.minItems, alSchema.properties.texts.maxItems], [5, 5]);

var merged = daily.applyAloud(draft, { texts: [
  'I did absolutely nothing all weekend.', 'The chair still has not shown up.'] });
check('고친 영어가 들어간다', merged.sentences[0].text,
  'I did absolutely nothing all weekend.');
check('안 고친 것은 그대로', merged.sentences[1].text, 'The chair still has not shown up.');
check('한국어와 note 는 건드리지 않는다',
  [merged.sentences[0].ko, merged.sentences[0].situation], ['주말에 아무것도 안 했어.', '가']);
check('몇 개를 고쳤는지 센다', merged.aloudChanged, 1);
check('안 고쳤으면 0', daily.applyAloud(draft, { texts: [
  'I did nothing all weekend.', 'The chair still has not shown up.'] }).aloudChanged, 0);
check('개수가 어긋나면 손대지 않는다',
  daily.applyAloud(draft, { texts: ['One only.'] }), null);
check('빈 문장이 오면 손대지 않는다',
  daily.applyAloud(draft, { texts: ['Fine.', '  '] }), null);

console.log('\n어떤 모델이 답했는지 기록에 남기기');
var model = require('./daily_model').modelOf;
check('modelUsage 에서 꺼낸다',
  model(JSON.stringify({ modelUsage: { 'claude-opus-4-5-20251101': {} } })),
  'claude-opus-4-5-20251101');
check('model 칸에서도 꺼낸다',
  model(JSON.stringify({ model: 'claude-sonnet-4-5' })), 'claude-sonnet-4-5');
check('모양이 달라도 글에서 찾아낸다',
  model('알 수 없는 모양 claude-opus-4-5-20251101 끝'), 'claude-opus-4-5-20251101');
check('없으면 빈 값을 돌려준다', model('{}'), '');

var rs = daily.buildReviewSchema({ count: 5 });
check('고친 것을 적는 칸이 있다', rs.required.sort(), ['problems', 'sentences']);
check('문장 개수는 그대로 못 박는다',
  [rs.properties.sentences.minItems, rs.properties.sentences.maxItems], [5, 5]);

check('검수 결과도 같은 검사를 그대로 받는다',
  daily.validate({ problems: ['고쳤음'], sentences: [row(), row({
    text: 'She would have called us. The meeting ran late again.',
    ko: '연락했을 거야. 회의가 또 늦게 끝났어.' })] }, CFG), []);
check('고친 내용은 파일에 남는다',
  daily.toDayFile({ problems: ['관용구를 고쳤습니다'], sentences: [row()] }, '2026-08-23').reviewed,
  ['관용구를 고쳤습니다']);

console.log('\n앱이 읽는 모양으로 바꾸기 — 영상 파일과 같아야 문장카드가 붙는다');
var day = daily.toDayFile({ sentences: [row()] }, '2026-08-23');
check('videoId 에 날짜가 들어간다', day.videoId, 'daily-2026-08-23');
check('출처 표시', day.source, 'daily');
check('문장 번호는 0 부터', day.sentences[0].i, 0);
check('한국어가 있어야 한→영 카드가 된다', !!day.sentences[0].ko, true);
check('영상 문장과 같은 칸을 갖춘다',
  Object.keys(day.sentences[0]).sort(),
  ['alts', 'end', 'i', 'ko', 'note', 'recording', 'situation', 'start', 'text']);
check('말투 딱지가 그대로 넘어간다',
  day.sentences[0].alts.map(function (a) { return a.style; }), ['casual', 'formal']);
check('옛 파일의 글 목록도 읽힌다',
  daily.normalizeAlts(['That timeline feels rough.']),
  [{ style: 'casual', text: 'That timeline feels rough.' }]);
check('앞뒤 공백은 지운다',
  daily.toDayFile({ sentences: [row({ text: '  That deadline is tough. We need time.  ' })] },
    '2026-08-23').sentences[0].text,
  'That deadline is tough. We need time.');

console.log('\n하루에 여러 묶음 — 붙이되 앞 번호를 밀지 않는다');
var A = daily.toDayFile({ sentences: [row(), row({
  text: 'She would have called us. The meeting ran late again.',
  ko: '연락했을 거야. 회의가 또 늦게 끝났어.' })] }, '2026-08-23');
var B = daily.toDayFile({ sentences: [row({
  text: 'That budget is tight. We should talk before Friday.',
  ko: '예산이 빠듯해. 금요일 전에 얘기하자.' })] }, '2026-08-23');

// appendDay 는 파일을 읽으므로 여기서는 붙이는 규칙만 따로 확인한다
function merge(oldDay, newDay) {
  var seen = {}, out = oldDay.sentences.slice();
  for (var i = 0; i < out.length; i++) {
    seen[out[i].text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()] = true;
  }
  for (var j = 0; j < newDay.sentences.length; j++) {
    var one = newDay.sentences[j];
    var k = one.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (seen[k]) continue;
    seen[k] = true;
    one.i = out.length;
    out.push(one);
  }
  return out;
}
var merged = merge(A, B);
check('뒤에 붙는다', merged.length, 3);
check('앞 번호는 그대로 (담아 둔 카드가 어긋나면 안 된다)',
  [merged[0].i, merged[1].i], [0, 1]);
check('붙은 것은 다음 번호를 받는다', merged[2].i, 2);
check('같은 문장은 두 번 안 붙는다', merge(A, A).length, 2);

console.log('\n묶음 — 날짜에 묶여 있지 않다 (공부한 날은 앱이 따로 기억한다)');
var setFile = daily.toSetFile({ sentences: [row(), row({
  text: 'She would have called us. The meeting ran late again.',
  ko: '연락했을 거야. 회의가 또 늦게 끝났어.' })] }, 's007', '2026-08-23');
check('videoId 는 묶음 번호를 가리킨다', setFile.videoId, 'daily-s007');
check('만든 날은 남긴다 (날짜에 묶는 것이 아니다)', setFile.madeAt, '2026-08-23');
check('번호는 0 부터', [setFile.sentences[0].i, setFile.sentences[1].i], [0, 1]);
check('제목은 사람이 읽을 수 있게', setFile.title, 'Set 7');
check('영상 문장과 같은 칸을 갖춘다',
  Object.keys(setFile.sentences[0]).sort(),
  ['alts', 'end', 'i', 'ko', 'note', 'recording', 'situation', 'start', 'text']);

check('같은 글로 보는 열쇠 — 대소문자·문장부호 무시',
  daily.key('  That Deadline, is tough!  '), 'that deadline is tough');

console.log('\n상황 고르기 — 최근에 쓴 것은 뒤로 미룬다');
var all = ['가', '나', '다', '라'];
var first = function () { return 0; };   // 섞기를 고정해서 결과를 볼 수 있게 한다
check('최근 것을 빼고 고른다',
  daily.pickSituations(all, ['가', '나'], 2, first).sort(), ['다', '라']);
check('전부 최근이어도 빈손으로 오지 않는다',
  daily.pickSituations(all, all, 2, first).length, 2);
check('요청한 개수만큼만', daily.pickSituations(all, [], 3, first).length, 3);
check('있는 것보다 많이 달라고 하면 있는 만큼',
  daily.pickSituations(all, [], 9, first).length, 4);

console.log('\n날짜 — 한국 기준이라야 아침에 오늘 것이 있다');
check('UTC 로 전날 저녁이어도 한국은 다음 날',
  daily.todayKST(new Date('2026-08-22T21:30:00Z')), '2026-08-23');
check('UTC 로 같은 날 낮이면 그대로',
  daily.todayKST(new Date('2026-08-22T03:00:00Z')), '2026-08-22');

console.log('\n지시문 — 조건이 실제로 담기는지');
var prompt = daily.buildPrompt({
  count: 2, minWords: 20, maxWords: 35,
  shortWords: 20, shortCount: 2,
  situations: ['회의에서 반대하기', '병원에서 증상 설명'],
  vocab: ['concentrated', 'threatened']
});
check('단어 수 조건이 들어간다', prompt.indexOf('20~35 단어') >= 0, true);
check('상황이 들어간다', prompt.indexOf('병원에서 증상 설명') >= 0, true);
check('어휘가 들어간다', prompt.indexOf('concentrated') >= 0, true);
check('다른 표현을 요구한다', prompt.indexOf('"alts"') >= 0, true);
check('캐주얼·포멀을 나누라고 한다',
  prompt.indexOf('"casual"') >= 0 && prompt.indexOf('"formal"') >= 0, true);
check('note 에 강조를 넣으라고 한다', prompt.indexOf('별표 두 개') >= 0, true);
check('편한 말투를 못 박는다', prompt.indexOf('편한 동료에게 하는 말투') >= 0, true);
check('격식체를 금지한다', prompt.indexOf('격식체') >= 0, true);
check('축약형을 쓰라고 한다', prompt.indexOf('축약형') >= 0, true);
check('영어를 먼저 만들라고 한다', prompt.indexOf('영어를 먼저 만듭니다') >= 0, true);
check('말버릇을 장식으로 넣지 말라고 한다',
  prompt.indexOf('장식으로 넣지 마세요') >= 0, true);
check('한 문장으로 끝나도 된다고 한다', prompt.indexOf('한 문장으로 끝나도 됩니다') >= 0, true);
check('쉼표로 잇지 말라고 한다', prompt.indexOf('쉼표로 계속 이으면 안 됩니다') >= 0, true);
check('규칙을 채우려고 늘리지 말라고 한다',
  prompt.indexOf('채워야 하는 양이 아닙니다') >= 0, true);
check('that 이 무엇을 가리키는지 못 박는다',
  prompt.indexOf('무엇을 가리키는지 낱말 하나로 짚을 수 있어야') >= 0, true);
check('난이도는 내용에서 나온다고 한다',
  prompt.indexOf('난이도는 길이가 아니라 내용에서') >= 0, true);
check('길이를 서로 다르게 하라고 한다', prompt.indexOf('길이를 서로 다르게 하세요') >= 0, true);
check('짧은 것을 쉽게 만들지 말라고 한다',
  prompt.indexOf('짧은 것을 쉬운 것으로 만들지 마세요') >= 0, true);
check('짧은 것 개수를 안 주면 그 대목을 아예 안 넣는다',
  daily.buildPrompt({ count: 5, minWords: 12, maxWords: 28, situations: ['가'], vocab: [] })
    .indexOf('길이를 서로 다르게') >= 0, false);
check('한국에만 있는 것을 옮기지 말라고 한다',
  prompt.indexOf('한국에만 있는 것을 영어로 옮기지 마세요') >= 0, true);
check('1차 2차를 round 로 옮기지 말라고 한다',
  prompt.indexOf('first round, second round 로 옮기면 안 됩니다') >= 0, true);
check('돈은 달러로 쓰라고 한다', prompt.indexOf('돈은 달러로 씁니다') >= 0, true);
check('한국어 숫자도 같아야 한다고 한다',
  prompt.indexOf('영어와 한국어의 숫자가 같아야 합니다') >= 0, true);
check('한국어는 그 영어를 옮기는 것이라고 한다',
  prompt.indexOf('이제는 영어가 기준입니다') >= 0, true);

var withRecent = daily.buildPrompt({
  count: 1, minWords: 12, maxWords: 35, situations: ['가'], vocab: [],
  recent: ['I could not lift my arms to wash my hair.']
});
check('최근 문장을 보여 준다',
  withRecent.indexOf('I could not lift my arms to wash my hair.') >= 0, true);
check('겹치지 말라고 한다', withRecent.indexOf('같은 이야기를 다시 만들면 안 됩니다') >= 0, true);
check('최근 문장이 없으면 그 대목을 아예 안 넣는다',
  daily.buildPrompt({ count: 1, minWords: 12, maxWords: 35, situations: ['가'], vocab: [] })
    .indexOf('최근에 이미 나온 문장') >= 0, false);
check('구체적으로 쓰라고 한다', prompt.indexOf('it, that, this 로 얼버무리지') >= 0, true);
check('맞히기 시험이 아니라고 못 박는다', prompt.indexOf('맞히기 시험이 아니라') >= 0, true);
check('어휘가 없으면 그 대목을 아예 안 넣는다',
  daily.buildPrompt({ count: 1, minWords: 20, maxWords: 35, situations: ['가'], vocab: [] })
    .indexOf('어휘 참고') >= 0, false);

console.log('\n최근 상황과 최근 문장 — 묶음을 읽는지');
var pid0 = daily.profileIds()[0];
var sets0 = daily.listSets(pid0);
if (sets0.length) {
  var lastId = sets0[sets0.length - 1].id;
  var lastSet = require('../data/daily/' + pid0 + '/sets/' + lastId + '.json');
  var avoided = daily.recentSituations(pid0, 14, 3);
  check('마지막 묶음의 상황이 피할 목록에 든다',
    avoided.indexOf(lastSet.sentences[0].situation) >= 0, true);
  var texts = daily.recentTexts(pid0, 3);
  check('마지막 묶음의 영어가 겹침 방지 목록에 든다',
    texts.indexOf(lastSet.sentences[0].text) >= 0, true);
  check('묶음 개수만큼만 본다', texts.length <= 3 * daily.config().count, true);
  check('0 을 주면 기본값(4묶음)으로 떨어진다', daily.recentTexts(pid0, 0).length,
    daily.recentTexts(pid0, 4).length);
}
check('상황 목록에 회식이 남아 있지 않다',
  daily.config().situations.join(' ').indexOf('회식') >= 0, false);

console.log('\n저장소에 실제로 들어 있는 설정으로도 되는지');
var cfg = daily.config();
check('상황이 요청 개수보다 많다', cfg.situations.length > cfg.count, true);
check('단어 수 범위가 뒤집혀 있지 않다', cfg.minWords < cfg.maxWords, true);
check('프로필이 하나 이상 있다', daily.profileIds().length > 0, true);

console.log(failed ? '\n실패 ' + failed + '건\n' : '\n전부 통과\n');
process.exit(failed ? 1 : 0);
