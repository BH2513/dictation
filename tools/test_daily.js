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
    text: 'I honestly think that deadline is going to be tough for us.',
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
  text: 'She would have called us if the meeting had ended earlier today.',
  ko: '회의가 일찍 끝났으면 연락했을 겁니다.'
})] }, CFG), []);

check('sentences 가 없으면', daily.validate({}, CFG), ['sentences 목록이 없습니다.']);

check('개수가 모자라면',
  daily.validate({ sentences: [row()] }, CFG),
  ['문장이 2개여야 하는데 1개입니다.']);

check('문장이 짧으면 잡는다',
  daily.validate({ sentences: [row({ text: 'Too short.' })] }, CFG).slice(1),
  ['문장 1: 영어 문장이 2 단어입니다 (5~12 이어야 합니다).']);

check('문장이 길면 잡는다',
  daily.validate({ sentences: [row({
    text: 'one two three four five six seven eight nine ten eleven twelve thirteen'
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
    text: 'She would have called us if the meeting had ended earlier today.',
    ko: '회의가 일찍 끝났으면 연락했을 겁니다.' })] }, CFG), []);

check('같은 문장이 두 번 나오면 잡는다',
  daily.validate({ sentences: [row(), row()] }, CFG),
  ['문장 2: 앞 문장과 같습니다.']);

check('대소문자·문장부호만 다른 중복도 잡는다',
  daily.validate({ sentences: [row(), row({
    text: 'I HONESTLY THINK THAT DEADLINE IS GOING TO BE TOUGH FOR US!!'
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

console.log('\ncasual 이 정답과 겹치는지');
check('앞 네 낱말이 같으면 같은 문장으로 본다',
  daily.sameOpening('Part of me wants to move now.', 'Part of me wants to stay.'), true);
check('앞부분이 다르면 통과',
  daily.sameOpening('Part of me wants to move.', 'I keep thinking about moving.'), false);
check('대소문자와 문장부호는 무시', daily.sameOpening('I am, honestly, fine.', 'i am honestly fine'), true);
check('한쪽이 비면 false', daily.sameOpening('', 'anything'), false);

check('겹치면 검사에서 잡는다',
  daily.validate({ sentences: [row({ alts: [
    { style: 'casual', text: 'I honestly think that deadline is rough.' },
    { style: 'formal', text: 'That timeline appears unrealistic to me.' }] })] }, CFG).slice(1),
  ['문장 1: casual 이 정답과 앞부분이 같습니다.']);

console.log('\n검수 — 만든 것을 한 번 더 읽히는 단계');
var rev = daily.buildReviewPrompt({ sentences: [row()] }, { count: 5, minWords: 20, maxWords: 35 });
check('초안이 지시문에 담긴다', rev.indexOf('I honestly think that deadline') >= 0, true);
check('관용구 오용을 보라고 한다', rev.indexOf('hit the spot') >= 0, true);
check('지적만 말고 고치라고 한다', rev.indexOf('직접 고쳐서 내놓으세요') >= 0, true);
check('개수를 바꾸지 말라고 한다', rev.indexOf('문장 개수(5개)') >= 0, true);

var rs = daily.buildReviewSchema({ count: 5 });
check('고친 것을 적는 칸이 있다', rs.required.sort(), ['problems', 'sentences']);
check('문장 개수는 그대로 못 박는다',
  [rs.properties.sentences.minItems, rs.properties.sentences.maxItems], [5, 5]);

check('검수 결과도 같은 검사를 그대로 받는다',
  daily.validate({ problems: ['고쳤음'], sentences: [row(), row({
    text: 'She would have called us if the meeting had ended earlier today.',
    ko: '회의가 일찍 끝났으면 연락했을 겁니다.' })] }, CFG), []);
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
  daily.toDayFile({ sentences: [row({ text: '  I honestly think that deadline is tough.  ' })] },
    '2026-08-23').sentences[0].text,
  'I honestly think that deadline is tough.');

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
check('일상 대화체를 못 박는다', prompt.indexOf('일상 대화체') >= 0, true);
check('격식체를 금지한다', prompt.indexOf('격식체') >= 0, true);
check('축약형을 쓰라고 한다', prompt.indexOf('축약형') >= 0, true);
check('맞히기 시험이 아니라고 못 박는다', prompt.indexOf('맞히기 시험이 아니라') >= 0, true);
check('어휘가 없으면 그 대목을 아예 안 넣는다',
  daily.buildPrompt({ count: 1, minWords: 20, maxWords: 35, situations: ['가'], vocab: [] })
    .indexOf('어휘 참고') >= 0, false);

console.log('\n저장소에 실제로 들어 있는 설정으로도 되는지');
var cfg = daily.config();
check('상황이 요청 개수보다 많다', cfg.situations.length > cfg.count, true);
check('단어 수 범위가 뒤집혀 있지 않다', cfg.minWords < cfg.maxWords, true);
check('프로필이 하나 이상 있다', daily.profileIds().length > 0, true);

console.log(failed ? '\n실패 ' + failed + '건\n' : '\n전부 통과\n');
process.exit(failed ? 1 : 0);
