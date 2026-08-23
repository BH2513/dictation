// talkui.js 의 "언제 보낼까" 판단만 떼어 확인한다 (브라우저 없이).
// 생각하는 사이에 말을 잘라 버리면 대화가 깨진다. 그 판단이 이 파일에 걸려 있다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'talkui.js'), 'utf8');
const start = src.indexOf('var QUIET_MS = ');
const end = src.indexOf('function $(id)');
if (start < 0 || end < 0) { console.log('talkui.js 에서 기다리는 부분을 못 찾았다'); process.exit(1); }
eval(src.slice(start, end));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  OK   ' : '  실패 ') + name);
  if (!ok) {
    console.log('       받은 값:', JSON.stringify(got));
    console.log('       기대값:', JSON.stringify(want));
    failed++;
  }
}
// 화면 쪽이 쓰는 것과 같은 셈
function waitFor(text) { return stillGoing(text) ? QUIET_MS + CARRY_MS : QUIET_MS; }

console.log('\n실제로 잘렸던 말 — 이게 다시 잘리면 안 된다');
check('"It\'s kind of a" 는 아직 하는 중이다', stillGoing("It's kind of a"), true);
check('그래서 더 기다린다', waitFor("It's kind of a"), QUIET_MS + CARRY_MS);

console.log('\n아직 이어질 것 같은 끝맺음');
[
  ['관사로 끝남', 'I went to the'],
  ['전치사로 끝남', 'I was talking to'],
  ['접속사로 끝남', 'It was fine but'],
  ['조동사로 끝남', 'I think it is'],
  ['대명사로 끝남', 'And then I told her that I'],
  ['쉼표로 끝남', 'Well, I mean,'],
  ['말버릇으로 끝남', "It's sort of"],
  ['부정어로 끝남', 'I could not'],
  ['아무 말도 안 함', ''],
  ['공백만', '   ']
].forEach(([name, text]) => check(name, stillGoing(text), true));

console.log('\n끝난 것 같은 끝맺음 — 오래 기다리면 답답하다');
[
  ['마침표로 끝남', 'I went to the meeting yesterday.'],
  ['물음표로 끝남', 'How was your weekend?'],
  ['보통 낱말로 끝남', 'That went better than I expected'],
  ['이름으로 끝남', 'I met my sister'],
  ['숫자로 끝남', 'It cost about thirty dollars']
].forEach(([name, text]) => check(name, stillGoing(text), false));

console.log('\n기다리는 시간');
check('끝난 것 같으면 짧게', waitFor('That went better than I expected'), QUIET_MS);
check('이어질 것 같으면 길게', waitFor('That went better than I'), QUIET_MS + CARRY_MS);
check('짧은 쪽도 2초는 넘는다 (생각할 틈)', QUIET_MS >= 2000, true);
check('긴 쪽은 4초는 넘는다', QUIET_MS + CARRY_MS >= 4000, true);
check('그래도 8초는 안 넘는다 (넘으면 멈춘 줄 안다)', QUIET_MS + CARRY_MS <= 8000, true);

console.log('\n어느 쪽으로 틀릴지 — 헷갈리면 기다리는 쪽이다');
check('이어질 것 같을 때가 더 오래', waitFor('I went to the') > waitFor('I went to the meeting.'), true);
check('대문자로 써도 같게 본다', stillGoing('I WENT TO THE'), true);
check('마침표가 붙은 관사도 잡는다', stillGoing('I went to the.'), true);

console.log('\n마이크를 언제 놓아 줄까 — 아이폰 마이크 소리를 줄이는 유일한 길이다');
// 아이폰이 내는 "띠롱" 은 우리가 못 없앤다. 사파리가 저 혼자 끝낼 때마다 다시 켜면
// 그 소리가 되풀이되므로, 오래 조용하면 다시 안 켠다.
check('막 켰으면 계속 듣는다', keepListening(0), true);
check('잠깐 조용한 것은 그냥 생각하는 중이다', keepListening(3000), true);
check('한참 뜸을 들여도 아직 듣는다', keepListening(30000), true);
check('그래도 이만큼 조용하면 놓아 준다', keepListening(IDLE_GIVEUP_MS), false);
check('그보다 더 조용해도 놓아 준다', keepListening(IDLE_GIVEUP_MS + 5000), false);
check('놓아 주기 직전까지는 듣는다', keepListening(IDLE_GIVEUP_MS - 1), true);

console.log('\n놓아 주는 시각 — 여기서도 헷갈리면 기다리는 쪽이다');
check('제일 오래 기다리는 것보다 훨씬 길다', IDLE_GIVEUP_MS > QUIET_MS + CARRY_MS, true);
check('생각할 시간으로 30초는 넘게 준다', IDLE_GIVEUP_MS >= 30000, true);
check('그래도 몇 분씩 켜 두지는 않는다', IDLE_GIVEUP_MS <= 180000, true);

console.log('');
if (failed) { console.log('실패 ' + failed + '개'); process.exit(1); }
console.log('전부 통과했습니다.');
