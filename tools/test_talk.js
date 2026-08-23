// talk.js 의 "답의 모양" 과 지시문만 떼어 확인한다 (브라우저 없이).
// 이 단계의 존재 이유가 **교정 칸이 반드시 채워지는 것**이라, 그 약속이 깨지면 바로 걸리게 한다.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'talk.js'), 'utf8');
const start = src.indexOf('var TURN_SCHEMA = {');
const end = src.indexOf('/* ------------------------------------------------------------------ 실패를 갈라 놓는다');
if (start < 0 || end < 0) { console.log('talk.js 에서 모양/지시문 부분을 못 찾았다'); process.exit(1); }
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

console.log('\n답의 모양 — 네 칸이 다 필수여야 한다');
check('교정 칸이 필수다', TURN_SCHEMA.required.indexOf('corrected') >= 0, true);
check('더 자연스럽게 칸이 필수다', TURN_SCHEMA.required.indexOf('natural') >= 0, true);
check('왜 칸이 필수다', TURN_SCHEMA.required.indexOf('why') >= 0, true);
check('AI 대답 칸이 필수다', TURN_SCHEMA.required.indexOf('reply') >= 0, true);
check('네 칸뿐이다', TURN_SCHEMA.required.length, 4);
check('빈 칸을 채워 넣지 못하게 막는다', TURN_SCHEMA.additionalProperties, false);
check('모든 칸에 정의가 있다',
  TURN_SCHEMA.required.every(k => !!TURN_SCHEMA.properties[k]), true);

console.log('\n요약의 모양 — 운영자가 꼽은 네 가지 중 4번 (ROADMAP)');
['summary', 'did_well', 'to_fix', 'culture', 'words'].forEach(k => {
  check(k + ' 칸이 필수다', SUMMARY_SCHEMA.required.indexOf(k) >= 0, true);
});
check('다섯 칸뿐이다', SUMMARY_SCHEMA.required.length, 5);
check('빈 칸을 채워 넣지 못하게 막는다', SUMMARY_SCHEMA.additionalProperties, false);

console.log('\n지시문 — 대화 밖에 두는 것이라 매번 같아야 한다');
{
  const a = systemPrompt({ topic: '주말 얘기', misses: ['the', 'a'], recent: ['I ended up staying in.'] });
  const b = systemPrompt({ topic: '주말 얘기', misses: ['the', 'a'], recent: ['I ended up staying in.'] });
  check('같은 재료면 글자까지 같다 (안 그러면 캐싱이 매번 깨진다)', a === b, true);
  check('교정하라는 말이 들어 있다', /corrected/.test(a), true);
  check('매 턴 하라고 못 박는다', /does not stop applying/.test(a), true);
  check('주제가 들어간다', a.indexOf('주말 얘기') >= 0, true);
  check('자주 틀리는 낱말이 들어간다', /often gets these words wrong/.test(a), true);
  check('그 낱말이 실제로 적힌다', a.indexOf('the, a') >= 0, true);
  check('최근 문장이 들어간다', a.indexOf('I ended up staying in.') >= 0, true);
}

console.log('\n재료가 없으면 그 줄은 아예 안 넣는다 (빈 줄이 남으면 캐싱만 나빠진다)');
{
  const bare = systemPrompt({ topic: '', misses: [], recent: [] });
  check('약점 줄 없음', /often gets these words wrong/.test(bare), false);
  check('최근 문장 줄 없음', /They recently studied/.test(bare), false);
  check('주제 줄 없음', /Today you are talking about/.test(bare), false);
  check('그래도 교정 지시는 남는다', /corrected/.test(bare), true);
}
{
  const none = systemPrompt(null);
  check('재료가 통째로 없어도 안 터진다', typeof none === 'string' && none.length > 0, true);
}

console.log('\n지시문이 캐싱 최소 크기를 넘길 만한가');
{
  // Haiku 4.5 는 앞부분이 4,096 토큰을 넘어야 캐싱이 걸린다 (ROADMAP 비용 절).
  // 영어는 대략 글자 4개가 토큰 1개다. 여기서는 "재료를 실으면 늘어난다" 만 본다 —
  // 실제로 넘는지는 청구서로 확인한다.
  const bare = systemPrompt({ topic: '', misses: [], recent: [] });
  const full = systemPrompt({
    topic: '친구랑 여행 일정 맞추기',
    misses: Array.from({ length: 20 }, (_, i) => 'word' + i),
    recent: Array.from({ length: 8 }, (_, i) => 'A sentence number ' + i + ' that they studied.')
  });
  check('재료를 실으면 지시문이 길어진다', full.length > bare.length, true);
  check('실을 것을 다 실으면 눈에 띄게 길어진다', full.length - bare.length > 300, true);
}

console.log('');
if (failed) { console.log('실패 ' + failed + '개'); process.exit(1); }
console.log('전부 통과했습니다.');
