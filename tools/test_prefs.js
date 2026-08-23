// prefs.js 의 값 다루는 부분만 떼어 확인한다 (브라우저 없이).
// 사람마다 고르는 것이라, 모르는 값이 들어와도 화면이 멈추면 안 된다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'prefs.js'), 'utf8');
const start = src.indexOf('var DEFAULTS = {');
const end = src.indexOf('  /* 고른 것을 화면에 먹인다');
if (start < 0 || end < 0) { console.log('prefs.js 에서 값 부분을 못 찾았다'); process.exit(1); }
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

console.log('\n기본값 — 한 곳에만 둔다');
check('어두운 쪽으로 시작', DEFAULTS.theme, 'dark');
check('글자는 보통', DEFAULTS.textSize, 'normal');
check('누르는 쪽이 기본이다 (2026-08-26 운영자 결정)', DEFAULTS.turnTaking, 'manual');
check('기다리는 시간은 2.5초', DEFAULTS.waitSec, 2.5);
check('고를 것이 다 목록에 있다',
  Object.keys(CHOICES).every(k => DEFAULTS.hasOwnProperty(k)), true);
check('답을 읽어 줄 목소리도 있다', DEFAULTS.hasOwnProperty('voice'), true);
check('목록의 값이 기본값에 실제로 있다',
  Object.keys(CHOICES).every(k => CHOICES[k].some(o => o.value === DEFAULTS[k])), true);

console.log('\n저절로 보내는 쪽도 지우지 않았다 — 한쪽만 두면 다른 쪽 사람이 못 쓴다');
check('두 갈래가 다 있다', CHOICES.turnTaking.map(o => o.value), ['manual', 'auto']);
check('밝은 쪽도 고를 수 있다', CHOICES.theme.map(o => o.value), ['dark', 'light']);
check('글자는 세 단계', CHOICES.textSize.length, 3);

console.log('\n이상한 값이 와도 기본값으로 되돌린다 (옛 백업을 불러올 수 있다)');
check('빈 것', clean(null), DEFAULTS);
check('아무것도 없는 것', clean({}), DEFAULTS);
check('모르는 테마', clean({ theme: 'neon' }).theme, 'dark');
check('모르는 글자 크기', clean({ textSize: 'huge' }).textSize, 'normal');
check('모르는 대화 방식', clean({ turnTaking: 'psychic' }).turnTaking, 'manual');
check('모르는 칸은 그냥 버린다', clean({ nonsense: 1 }).nonsense, undefined);

console.log('\n기다리는 시간 — 울타리 밖은 안 받는다');
check('너무 짧으면 안 받는다', clean({ waitSec: 0.2 }).waitSec, 2.5);
check('너무 길면 안 받는다', clean({ waitSec: 60 }).waitSec, 2.5);
check('글자로 와도 숫자로 읽는다', clean({ waitSec: '4' }).waitSec, 4);
check('말이 안 되면 안 받는다', clean({ waitSec: 'soon' }).waitSec, 2.5);
check('아래 끝은 받는다', clean({ waitSec: WAIT_MIN }).waitSec, WAIT_MIN);
check('위 끝도 받는다', clean({ waitSec: WAIT_MAX }).waitSec, WAIT_MAX);
check('소수점 한 자리까지', clean({ waitSec: 3.333 }).waitSec, 3.3);

console.log('\n목소리 — 폰마다 목록이 달라서 값을 미리 정해 둘 수 없다');
check('처음에는 폰이 고른 대로', DEFAULTS.voice, '');
check('글자면 그대로 받는다', clean({ voice: 'Samantha' }).voice, 'Samantha');
check('빈 값도 받는다 (폰이 고른 대로로 되돌리는 것)', clean({ voice: '' }).voice, '');
check('글자가 아니면 안 받는다', clean({ voice: 42 }).voice, '');
check('고를 목록에 넣지 않는다 — 폰이 알려 줘야 안다', CHOICES.voice, undefined);

console.log('\n제대로 된 값은 그대로 통과');
{
  const mine = { theme: 'light', textSize: 'larger', turnTaking: 'auto', waitSec: 5, voice: 'Daniel' };
  check('다섯 다 그대로', clean(mine), mine);
  check('하나만 이상해도 나머지는 산다',
    clean({ theme: 'light', textSize: 'nope', turnTaking: 'auto', waitSec: 5, voice: 'Daniel' }),
    { theme: 'light', textSize: 'normal', turnTaking: 'auto', waitSec: 5, voice: 'Daniel' });
}

console.log('\n손댄 값이 기본값을 더럽히면 안 된다');
{
  const a = clean({ theme: 'light' });
  a.theme = 'dark';
  check('기본값은 그대로', DEFAULTS.theme, 'dark');
  check('다음에 읽어도 안 섞인다', clean({ theme: 'light' }).theme, 'light');
}

console.log('');
if (failed) { console.log('실패 ' + failed + '개'); process.exit(1); }
console.log('전부 통과했습니다.');
