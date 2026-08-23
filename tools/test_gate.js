// app.js 의 1단계 판정 셈만 떼어 확인한다 (브라우저 없이).
// ROADMAP "매주 보는 것 — 1단계" 의 세 항목과, 넘어가는/멈추는 조건.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = src.indexOf('var GATE_WEEKS = ');
const end = src.indexOf('/* -------------------------------------------------------------- 1단계 판정 셈 끝 */');
if (start < 0 || end < 0) { console.log('app.js 에서 판정 셈 부분을 못 찾았다'); process.exit(1); }

// app.js 바깥에 있는 도우미. eval 한 코드가 이걸 그대로 쓴다.
function dateStr(d) {
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
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

const BASE = new Date(2026, 7, 23);            // 2026-08-23 을 오늘로 둔다
function d(back) {                              // back 일 전의 날짜 문자열
  const x = new Date(BASE.getTime());
  x.setDate(x.getDate() - back);
  return dateStr(x);
}

/* 한 주를 만드는 도우미. days 는 며칠 전에 열었는지, cards 도 같은 식이다 */
function make(opts) {
  const all = { plan: [], progress: [], cards: [], days: [] };
  (opts.opened || []).forEach(function (back, n) {
    const setId = 's' + (100 + n);
    all.plan.push({ date: d(back), setIds: [setId], showIds: [] });
    const sentences = {};
    for (let i = 0; i < (opts.perSet || 5); i++) {
      sentences[i] = (i < (opts.skipPerSet || 0)) ? 'skip' : 'ok';
    }
    all.progress.push({ videoId: 'daily-' + setId, sentences: sentences });
  });
  (opts.cards || []).forEach(function (back) { all.cards.push({ date: d(back) }); });
  all.days.push({ date: d(opts.firstDay === undefined ? 30 : opts.firstDay), count: 1 });
  return all;
}

console.log('\n주 나누기 — 오늘부터 거꾸로 7일씩');
check('이번 주는 오늘로 끝난다', gateRange(BASE, 0).to, d(0));
check('이번 주는 6일 전에 시작한다', gateRange(BASE, 0).from, d(6));
check('지난주는 7일 전에 끝난다', gateRange(BASE, 1).to, d(7));
check('지난주는 13일 전에 시작한다', gateRange(BASE, 1).from, d(13));

console.log('\n세는 것 — 연 날 / 건너뛴 비율 / 담은 카드');
{
  const all = make({ opened: [0, 1, 2, 3], perSet: 5, skipPerSet: 1, cards: [0, 1, 2] });
  const w = gateWeek(all, gateRange(BASE, 0).from, gateRange(BASE, 0).to);
  check('연 날을 센다', w.openDays, 4);
  check('문장 수를 센다', w.seen, 20);
  check('건너뛴 수를 센다', w.skipped, 4);
  check('건너뛴 비율', Math.round(w.skipRate * 100), 20);
  check('담은 카드를 센다', w.cards, 3);
  check('세 항목 다 통과', gatePassed(w), true);
}

console.log('\n주 경계');
{
  const all = make({ opened: [6, 7], cards: [6, 7] });
  const r0 = gateRange(BASE, 0);
  check('6일 전은 이번 주다', gateWeek(all, r0.from, r0.to).openDays, 1);
  check('7일 전은 이번 주가 아니다', gateWeek(all, r0.from, r0.to).cards, 1);
  const r1 = gateRange(BASE, 1);
  check('7일 전은 지난주다', gateWeek(all, r1.from, r1.to).openDays, 1);
}

console.log('\n같은 날 두 묶음을 해도 하루로 센다');
{
  const all = { plan: [{ date: d(0), setIds: ['s1', 's2'], showIds: [] }],
                progress: [], cards: [], days: [{ date: d(0), count: 1 }] };
  const r = gateRange(BASE, 0);
  check('하루는 하루다', gateWeek(all, r.from, r.to).openDays, 1);
}

console.log('\n다른 주의 묶음은 이 주의 건너뛴 비율에 안 들어간다');
{
  const all = make({ opened: [0, 10], perSet: 4, skipPerSet: 4 });
  const r = gateRange(BASE, 0);
  const w = gateWeek(all, r.from, r.to);
  check('이번 주 묶음만 센다', w.seen, 4);
}

console.log('\n받아쓰기 영상은 세지 않는다 — 1단계 판정은 Daily 얘기다');
{
  const all = { plan: [{ date: d(0), setIds: ['s1'], showIds: [] }],
                progress: [{ videoId: 'abc123xyz', sentences: { 0: 'skip', 1: 'skip' } },
                           { videoId: 'daily-s1', sentences: { 0: 'ok' } }],
                cards: [], days: [{ date: d(0), count: 1 }] };
  const r = gateRange(BASE, 0);
  check('영상 문장은 빠진다', gateWeek(all, r.from, r.to).seen, 1);
}

console.log('\n통과 조건 — 하나라도 미달이면 그 주는 미달');
{
  const base = { opened: [0, 1, 2, 3], perSet: 5, skipPerSet: 1, cards: [0, 1, 2] };
  function pass(over) {
    const all = make(Object.assign({}, base, over));
    const r = gateRange(BASE, 0);
    return gatePassed(gateWeek(all, r.from, r.to));
  }
  check('연 날이 3일이면 미달', pass({ opened: [0, 1, 2] }), false);
  check('건너뛴 비율이 40%면 미달', pass({ perSet: 5, skipPerSet: 2 }), false);
  check('건너뛴 비율이 정확히 30%면 미달 (3할 "미만" 이다)',
    pass({ opened: [0, 1], perSet: 10, skipPerSet: 3, cards: [0, 1, 2] }), false);
  check('카드가 2장이면 미달', pass({ cards: [0, 1] }), false);
}

console.log('\n아무것도 안 한 주가 통과로 보이면 안 된다');
{
  const all = { plan: [], progress: [], cards: [], days: [{ date: d(0), count: 1 }] };
  const r = gateRange(BASE, 0);
  const w = gateWeek(all, r.from, r.to);
  check('건너뛴 비율은 0 이지만', w.skipRate, 0);
  check('문장을 하나도 안 봤으므로 미달', gateChecks(w).skip, false);
  check('그 주는 미달', gatePassed(w), false);
}

console.log('\n시작 전의 주는 판정하지 않는다 (첫 주에 "멈춰라"가 뜨면 안 된다)');
{
  const all = make({ opened: [0, 1, 2, 3], perSet: 5, skipPerSet: 1, cards: [0, 1, 2], firstDay: 3 });
  const weeks = gateWeeks(all, BASE);
  check('이번 주는 판정한다', weeks[0].na, false);
  check('지난주는 시작 전이다', weeks[1].na, true);
  const v = gateVerdict(weeks);
  check('판정한 주는 하나뿐', v.judged, 1);
  check('연속 통과 1주', v.streak, 1);
  check('멈추라고 하지 않는다', v.stop, false);
  check('아직 넘어갈 때가 아니다', v.ready, false);
}

console.log('\n넘어가는 조건 — 4주 연속');
{
  const opened = [], cards = [];
  for (let wk = 0; wk < 4; wk++) {
    for (let i = 0; i < 4; i++) opened.push(wk * 7 + i);
    for (let i = 0; i < 3; i++) cards.push(wk * 7 + i);
  }
  const all = make({ opened: opened, perSet: 5, skipPerSet: 1, cards: cards, firstDay: 30 });
  const v = gateVerdict(gateWeeks(all, BASE));
  check('4주 연속 통과', v.streak, 4);
  check('넘어가도 된다', v.ready, true);
  check('멈추라고 하지 않는다', v.stop, false);
}

console.log('\n연속이 끊기면 처음부터 — 최근 주부터 센다');
{
  const opened = [], cards = [];
  for (let wk = 1; wk < 4; wk++) {                      // 이번 주만 비운다
    for (let i = 0; i < 4; i++) opened.push(wk * 7 + i);
    for (let i = 0; i < 3; i++) cards.push(wk * 7 + i);
  }
  const all = make({ opened: opened, perSet: 5, skipPerSet: 1, cards: cards, firstDay: 30 });
  const v = gateVerdict(gateWeeks(all, BASE));
  check('이번 주가 미달이면 연속은 0', v.streak, 0);
}

console.log('\n멈추는 조건 — 판정한 4주 중 두 주 이상이 절반 미만');
{
  const all = make({ opened: [0, 7], perSet: 5, skipPerSet: 0, cards: [], firstDay: 30 });
  const weeks = gateWeeks(all, BASE);
  const v = gateVerdict(weeks);
  check('네 주를 다 판정한다', v.judged, 4);
  check('절반을 못 채운 주가 여럿', v.low >= 2, true);
  check('멈추라고 한다', v.stop, true);
}
{
  // 세 항목 중 둘을 채우면 "절반 미만"이 아니다
  const opened = [], cards = [];
  for (let wk = 0; wk < 4; wk++) {
    for (let i = 0; i < 4; i++) opened.push(wk * 7 + i);   // 연 날 통과
    for (let i = 0; i < 3; i++) cards.push(wk * 7 + i);    // 카드 통과
  }
  const all = make({ opened: opened, perSet: 5, skipPerSet: 3, cards: cards, firstDay: 30 });
  const v = gateVerdict(gateWeeks(all, BASE));
  check('건너뛴 비율만 미달이면 멈추라고 하지 않는다', v.stop, false);
  check('그래도 넘어가지는 못한다', v.ready, false);
}

console.log('');
if (failed) { console.log('실패 ' + failed + '개'); process.exit(1); }
console.log('전부 통과했습니다.');
