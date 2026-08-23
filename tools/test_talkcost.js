// talk.js 의 "얼마 들었나" 셈만 떼어 확인한다 (브라우저 없이).
// 돈이 걸린 셈이라 조용히 틀리면 안 된다. 특히 캐싱 몫을 겹쳐 세는 것을 조심한다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'talk.js'), 'utf8');
const start = src.indexOf('var COMPANIES = {');
const end = src.indexOf('/* ------------------------------------------------------------------ 답의 모양을 강제한다');
if (start < 0 || end < 0) { console.log('talk.js 에서 회사표를 못 찾았다'); process.exit(1); }
eval(src.slice(start, end));

// 값 셈은 그 아래에 있다. 필요한 부분만 더 떼어 온다
const cs = src.indexOf('function costOf(');
const ce = src.indexOf('/* ------------------------------------------------------------------ 한 턴 주고받기');
eval(src.slice(cs, ce));

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
const round = (v, n) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);

console.log('\n단가 — 100만 토큰당 달러 (콘솔과 같은 단위여야 대조가 된다)');
{
  const p = company('anthropic').price;
  check('입력 $1', p.input, 1.00);
  check('출력 $5', p.output, 5.00);
  check('캐시에 넣을 때 1.25배', p.cacheWrite, 1.25);
  check('캐시에서 읽을 때 0.1배', p.cacheRead, 0.10);
}

console.log('\n기본 셈');
check('입력 100만 토큰이면 $1',
  costOf('anthropic', { input_tokens: 1000000, output_tokens: 0 }), 1);
check('출력 100만 토큰이면 $5',
  costOf('anthropic', { input_tokens: 0, output_tokens: 1000000 }), 5);
check('입력 1000 + 출력 200',
  round(costOf('anthropic', { input_tokens: 1000, output_tokens: 200 }), 6), 0.002);

console.log('\n캐싱 — 겹쳐 세면 안 된다');
{
  // input_tokens 는 **캐시에 안 걸린 나머지**다. 셋을 더해야 실제로 보낸 양이 된다
  const u = { input_tokens: 1000, cache_creation_input_tokens: 4000,
              cache_read_input_tokens: 10000, output_tokens: 200 };
  // 1000×1 + 4000×1.25 + 10000×0.1 + 200×5 = 1000 + 5000 + 1000 + 1000 = 8000 (100만분의)
  check('넣어 둔 것은 1.25배, 다시 읽은 것은 0.1배', round(costOf('anthropic', u), 6), 0.008);

  const same = { input_tokens: 15000, output_tokens: 200 };
  check('캐싱을 쓰면 같은 양이라도 싸다',
    costOf('anthropic', u) < costOf('anthropic', same), true);
}

console.log('\n없는 값이 와도 안 터진다');
check('사용량이 아예 없으면 0', costOf('anthropic', null), 0);
check('빈 것이면 0', costOf('anthropic', {}), 0);
check('출력만 있어도 센다',
  round(costOf('anthropic', { output_tokens: 1000 }), 6), 0.005);
check('음수가 오면 0 으로 본다',
  costOf('anthropic', { input_tokens: -5000, output_tokens: 0 }), 0);
check('모르는 회사면 0', costOf('nowhere', { input_tokens: 1000000 }), 0);

console.log('\n달러로 적는다 — 작은 값이 0 으로 보이면 안 된다');
check('0 은 $0', money(0), '$0');
check('아주 작으면 <$0.001', money(0.0002), '<$0.001');
check('센트 아래는 셋째 자리까지', money(0.0141), '$0.014');
check('$1 이 넘으면 둘째 자리까지', money(3.456), '$3.46');
check('없는 값이 와도 안 터진다', money(undefined), '$0');
check('원화가 아니라 달러다 (운영자 결정)', /^\$|^<\$/.test(money(0.05)), true);

console.log('\n실제로 있을 법한 대화 한 판');
{
  // 5턴. 캐싱이 안 걸리는 초반이라 제값을 낸다
  let total = 0;
  [940, 1120, 1300, 1480, 1660].forEach(input => {
    total += costOf('anthropic', { input_tokens: input, output_tokens: 140 });
  });
  // 입력 6,500 × $1/1M + 출력 700 × $5/1M = $0.0065 + $0.0035
  check('한 판에 딱 1센트', round(total, 4), 0.01);
  check('화면에 적히는 모양', money(total), '$0.010');
}

console.log('\n실제로 나온 청구서와 맞춰 본다 (2026-08-26, 운영자 콘솔)');
{
  // platform.claude.com → Usage 가 2026년 8월치로 보여 준 값이다.
  // 우리 셈이 청구서와 어긋나면 이 검사가 걸린다.
  const real = costOf('anthropic', { input_tokens: 7846, output_tokens: 1343 });
  check('입력 7,846 + 출력 1,343 이면 약 $0.015', round(real, 4), 0.0146);
  check('화면에는 이렇게 적힌다', money(real), '$0.015');
  check('1센트는 넘고 2센트는 안 넘는다', real > 0.01 && real < 0.02, true);
}

console.log('');
if (failed) { console.log('실패 ' + failed + '개'); process.exit(1); }
console.log('전부 통과했습니다.');
