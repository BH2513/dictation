// app.js 의 "연습에 못 쓰는 줄" 규칙만 떼어 확인한다 (브라우저 없이)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = src.indexOf('  var FILLER = {};');
const end = src.indexOf('  /* ---------------------------------------------------------------- 듣기 */');
if (start < 0 || end < 0) { console.log('app.js 에서 규칙 부분을 못 찾았다'); process.exit(1); }
eval(src.slice(start, end));

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log((ok ? '  OK   ' : '  실패 ') + name);
  if (!ok) { console.log('       받은 값:', got, '기대값:', want); failed++; }
}
const drop = (t) => check('빼기: ' + JSON.stringify(t), usableLine({ text: t }), false);
const keep = (t) => check('쓰기: ' + JSON.stringify(t), usableLine({ text: t }), true);

console.log('\n낱말 두 개 이하는 뺀다 (운영자 결정)');
['Hi.', 'Yeah.', 'Me too.', 'Oh, hey.', "It's mine.", 'What?', '253.', 'Thieves.'].forEach(drop);

console.log('\n세 낱말부터는 쓴다');
['Oh, I know.', 'I love you.', 'Are you okay?', 'Oh, my god.', 'Where is he?'].forEach(keep);

console.log('\n감탄사뿐인 줄은 길어도 뺀다');
['No, no, no.', 'Whoa, whoa, whoa.', 'Wait, wait, wait.', 'Okay, bye-bye.',
 'Oh, no, no, no, no.', 'HEY, HEY, HEY.'].forEach(drop);

console.log('\n감탄사가 섞여 있어도 알맹이가 있으면 쓴다');
['Oh, no, you did not.', 'Well, I told you.', 'Yeah, that was me.'].forEach(keep);

console.log('\n낱말 세기 — 문장부호만 있는 조각은 낱말이 아니다');
check('줄표는 안 센다', usableLine({ text: 'Stop — now.' }), false);
check('세 낱말과 줄표', usableLine({ text: 'I said — stop it.' }), true);
check('빈 글', usableLine({ text: '' }), false);
check('없는 문장', usableLine(null), false);

console.log(failed ? '\n실패 ' + failed + ' 건\n' : '\n모두 통과\n');
process.exit(failed ? 1 : 0);
