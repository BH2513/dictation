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
    alts: ['That timeline feels unrealistic to me, to be honest with you.'],
    note: 'to be honest 는 조심스럽게 반대할 때 씁니다.'
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
check('다른 정답이 최소 하나는 있어야 한다',
  schema.properties.sentences.items.properties.alts.minItems, 1);

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

check('다른 정답이 없으면 잡는다',
  daily.validate({ sentences: [row({ alts: [] })] }, CFG).slice(1),
  ['문장 1: 다른 정답(alts)이 없습니다.']);

check('같은 문장이 두 번 나오면 잡는다',
  daily.validate({ sentences: [row(), row()] }, CFG),
  ['문장 2: 앞 문장과 같습니다.']);

check('대소문자·문장부호만 다른 중복도 잡는다',
  daily.validate({ sentences: [row(), row({
    text: 'I HONESTLY THINK THAT DEADLINE IS GOING TO BE TOUGH FOR US!!'
  })] }, CFG),
  ['문장 2: 앞 문장과 같습니다.']);

console.log('\n앱이 읽는 모양으로 바꾸기 — 영상 파일과 같아야 문장카드가 붙는다');
var day = daily.toDayFile({ sentences: [row()] }, '2026-08-23');
check('videoId 에 날짜가 들어간다', day.videoId, 'daily-2026-08-23');
check('출처 표시', day.source, 'daily');
check('문장 번호는 0 부터', day.sentences[0].i, 0);
check('한국어가 있어야 한→영 카드가 된다', !!day.sentences[0].ko, true);
check('영상 문장과 같은 칸을 갖춘다',
  Object.keys(day.sentences[0]).sort(),
  ['alts', 'end', 'i', 'ko', 'note', 'recording', 'situation', 'start', 'text']);
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
