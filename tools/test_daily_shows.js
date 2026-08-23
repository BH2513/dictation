/* 영상·자막 대사 쪽 검사. 네트워크도 파일 쓰기도 필요 없다.
   돌리는 법:  node tools/test_daily_shows.js */
'use strict';

var shows = require('./daily_shows');

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

var LINES = [
  { text: 'She was already gone by the time I got there.', title: 'Show A', videoId: 'v1', i: 3, start: 1, end: 2 },
  { text: 'You have to hear me out on this one.', title: 'Show A', videoId: null, i: 0, start: null, end: null },
  { text: 'I told him it was not going to work.', title: 'Show B', videoId: null, i: 1, start: null, end: null }
];

function pick(over) {
  var base = {
    n: 1,
    text: 'She was already gone by the time I got there.',
    ko: '내가 갔을 땐 이미 가고 없더라고.',
    alts: [
      { style: 'casual', text: 'By the time I showed up she was gone.' },
      { style: 'formal', text: 'She had already departed before my arrival.' }
    ],
    note: '**by the time** ~ 는 "~할 무렵에는" 이라는 뜻입니다.'
  };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

console.log('\n고른 것 검사 — 실제로 한 말을 그대로 써야 한다');
check('멀쩡하면 문제 없음', shows.validate({ picked: [pick()], skipped: [] }, LINES, 5), []);

check('대사를 고치면 잡는다',
  shows.validate({ picked: [pick({ text: 'She was gone when I arrived.' })] }, LINES, 5)[0]
    .indexOf('원래 대사를 바꿨습니다') >= 0, true);

check('띄어쓰기 차이는 봐준다',
  shows.validate({ picked: [pick({
    text: '  She was already   gone by the time I got there. ' })] }, LINES, 5), []);

check('없는 후보 번호를 대면 잡는다',
  shows.validate({ picked: [pick({ n: 99 })] }, LINES, 5),
  ['고른 것 1: 후보 번호 99 은(는) 없습니다.']);

check('같은 후보를 두 번 고르면 잡는다',
  shows.validate({ picked: [pick(), pick()] }, LINES, 5)
    .indexOf('고른 것 2: 후보 1번을 두 번 골랐습니다.') >= 0, true);

check('하나도 안 고르면 잡는다',
  shows.validate({ picked: [] }, LINES, 5), ['고른 대사가 하나도 없습니다.']);

check('요청한 것보다 많이 고르면 잡는다',
  shows.validate({ picked: [pick(), pick({ n: 2,
    text: 'You have to hear me out on this one.' })] }, LINES, 1)[0],
  '1개까지인데 2개를 골랐습니다.');

check('적게 골라도 된다 — 억지로 채우는 것보다 낫다',
  shows.validate({ picked: [pick()] }, LINES, 5), []);

check('한국어가 비면 잡는다',
  shows.validate({ picked: [pick({ ko: '  ' })] }, LINES, 5),
  ['고른 것 1: 한국어가 비었습니다.']);

check('말투가 하나만 있으면 잡는다',
  shows.validate({ picked: [pick({ alts: [
    { style: 'casual', text: 'a' }, { style: 'casual', text: 'b' }] })] }, LINES, 5),
  ['고른 것 1: formal 표현이 없습니다.']);

check('note 강조가 문장에 없으면 잡는다',
  shows.validate({ picked: [pick({ note: '**swamped** 는 바쁘다는 뜻입니다.' })] }, LINES, 5),
  ['고른 것 1: note 에서 강조한 표현이 문장에 하나도 나오지 않습니다.']);

console.log('\n고르는 기준이 지시문에 담기는지');
var pr = shows.buildPrompt([{ title: 'Show A', text: 'x' }], { count: 5 });
check('화면을 봐야 아는 말을 버리라고 한다', pr.indexOf('화면을 봐야 아는 말') >= 0, true);
check('실제로 새어 나간 예를 든다', pr.indexOf('the next part is the best') >= 0, true);
check('뉴스·강연 말투를 버리라고 한다', pr.indexOf('뉴스·강연 말투') >= 0, true);
check('비속어를 빼라고 한다', pr.indexOf('비속어') >= 0, true);
check('못 채우면 채우지 말라고 한다', pr.indexOf('채우지 마세요') >= 0, true);

console.log('\n앱이 읽는 모양으로');
var day = shows.toDayFile({ picked: [pick(), pick({ n: 2,
  text: 'You have to hear me out on this one.',
  ko: '이건 좀 들어봐.',
  note: '**hear me out** 은 "끝까지 들어봐" 입니다.' })] }, LINES, '2026-08-24');

check('videoId 에 날짜가 들어간다', day.videoId, 'shows-2026-08-24');
check('출처 표시', day.source, 'shows');
check('작품 이름이 상황 자리에 들어간다', day.sentences[0].situation, 'Show A');
check('영어는 후보 것을 쓴다 (받은 것을 믿지 않는다)',
  day.sentences[0].text, LINES[0].text);
check('영상이 있으면 그 대목을 가리킨다',
  day.sentences[0].from, { videoId: 'v1', i: 3 });
check('자막 창고에서 온 것은 영상이 없다', day.sentences[1].from, null);
check('번호는 0 부터 다시 매긴다', [day.sentences[0].i, day.sentences[1].i], [0, 1]);

console.log('\n고르기 — 최근에 쓴 줄은 피한다');
var used = {};
used['t|she was already gone by the time i got there'] = true;
var picked = shows.pickLines(LINES, used, 2, function () { return 0; });
check('최근에 쓴 줄은 안 나온다',
  picked.filter(function (l) { return l.text.indexOf('already gone') >= 0; }).length, 0);
check('영상 번호로도 피한다',
  shows.pickLines(LINES, { 'v1|3': true }, 3, function () { return 0; }).length, 3);

console.log(failed ? '\n실패 ' + failed + '건\n' : '\n전부 통과\n');
process.exit(failed ? 1 : 0);
