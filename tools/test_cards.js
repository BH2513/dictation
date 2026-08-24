// app.js 의 문장카드 부분만 떼어 확인한다 (브라우저 없이).
//
// 카드는 "그 영상으로 가서 한 번 더 듣고, 돌아오면 보던 자리" 가 되어야 한다 (SPEC 7).
// 어느 카드에 영상이 있고 그 자리가 어디인지를 여기서 지킨다 — 갈래마다 자리가 다르다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = src.indexOf('  /* 이 카드를 영상에서 다시 들을 수 있는가');
const end = src.indexOf('  function drawCards(box, pid) {');
if (start < 0 || end < 0) { console.log('app.js 에서 카드 부분을 못 찾았다'); process.exit(1); }

// app.js 바깥에 있는 도우미. eval 한 코드가 이걸 그대로 쓴다
function isDailyId(videoId) {
  var id = String(videoId || '');
  return id.indexOf('daily-') === 0 || id.indexOf('shows-') === 0;
}
const window = {};   // markCardPos 가 브라우저를 찾는다. 없으면 아무것도 안 한다
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

console.log('\n대사(Shows)에서 담은 카드 — 원래 영상의 자리로 간다');
check('from 이 가리키는 영상과 자리',
  cardVideo({
    card: { videoId: 'shows-2026-08-24', i: 0 },
    s: { text: "And I've had my share of bad reviews.", from: { videoId: 'cWheLYR8moU', i: 2 } }
  }),
  { videoId: 'cWheLYR8moU', i: 2 });

check('묶음 안 자리(0번)가 아니라 영상 안 자리를 쓴다',
  cardVideo({
    card: { videoId: 'shows-2026-08-24', i: 3 },
    s: { text: 'Just wear what I suggest.', from: { videoId: 'abc123', i: 0 } }
  }),
  { videoId: 'abc123', i: 0 });

console.log('\n받아쓰기에서 담은 카드 — 카드 자체가 영상 문장이다');
check('영상 ID 와 자리 번호를 그대로 쓴다',
  cardVideo({ card: { videoId: '6nVAQaiLNkY', i: 12 }, s: { text: 'You have got to be kidding me.' } }),
  { videoId: '6nVAQaiLNkY', i: 12 });

console.log('\n영상이 없는 카드에는 단추를 만들지 않는다');
check('지어낸 하루 문장 (묶음)',
  cardVideo({ card: { videoId: 'daily-s001', i: 2 }, s: { text: 'I was going to call you.' } }), null);
check('지어낸 하루 문장 (옛 날짜 파일)',
  cardVideo({ card: { videoId: 'daily-2026-08-23', i: 1 }, s: { text: 'That is what I said.' } }), null);
check('대화에서 담은 것',
  cardVideo({ card: { videoId: 'talk-3', i: 0 }, s: { text: 'I would rather stay in.' } }), null);
check('대화 요약의 배울 표현',
  cardVideo({ card: { videoId: 'talk-3-w', i: 1 }, s: { text: 'call it a night' } }), null);

console.log('\n자리 번호 0 을 "없음" 으로 보면 안 된다 (첫 문장이 그렇다)');
check('from.i 가 0 이어도 영상으로 간다',
  cardVideo({ card: { videoId: 'shows-2026-08-24', i: 4 }, s: { text: 'Hey.', from: { videoId: 'zz', i: 0 } } }),
  { videoId: 'zz', i: 0 });
check('카드 자리가 0 이어도 영상으로 간다',
  cardVideo({ card: { videoId: 'zz', i: 0 }, s: { text: 'Hey there.' } }), { videoId: 'zz', i: 0 });

console.log('\n망가진 값에도 화면이 멈추면 안 된다');
check('from 이 반쪽만 있으면 카드 쪽 자리로 떨어진다',
  cardVideo({ card: { videoId: 'shows-2026-08-24', i: 1 }, s: { text: 'x', from: { i: 2 } } }), null);
check('문장을 못 읽었을 때',
  cardVideo({ card: { videoId: 'daily-s002', i: 0 }, s: {} }), null);

console.log('');
if (failed) { console.log(failed + ' 개 실패'); process.exit(1); }
console.log('모두 통과');
