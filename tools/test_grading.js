// app.js 의 채점 부분만 떼어 확인한다 (브라우저 없이)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = src.indexOf('var EXPAND = {');
const end = src.indexOf('/* ---------------------------------------------------------------- 받아쓰기 */');
eval(src.slice(start, end));

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  OK   ' : '  실패 ') + name);
  if (!ok) { console.log('       받은 값:', JSON.stringify(got)); console.log('       기대값:', JSON.stringify(want)); failed++; }
}
function score(ans, typed, strict) { const r = grade(ans, typed, !!strict); return r.right + '/' + r.total; }
function wrong(ans, typed, strict) {
  const r = grade(ans, typed, !!strict);
  return r.words.filter((w, i) => r.ok[i] === false);
}

console.log('\n관대 모드 — SPEC 6 채점 규칙');
check('완전히 같으면 만점',
  score("I have somebody who needs no introduction.", "I have somebody who needs no introduction."), '7/7');
check('대소문자 무시',
  score("I have somebody who needs no introduction.", "i have somebody who needs no introduction"), '7/7');
check('문장부호 무시',
  score("And we can go into that at another time.", "and we can go into that at another time"), '9/9');
check('축약형 it\'s = it is',
  score("It's a controlled company.", "it is a controlled company"), '4/4');
check('반대 방향 it is = it\'s',
  score("It is a controlled company.", "it's a controlled company"), '5/5');
check("don't = do not", score("I don't know.", "I do not know"), '3/3');
check('소유격은 축약형으로 안 봄 (Bill\'s → bills)',
  score("what Bill's going to talk about", "what bills going to talk about"), '6/6');
check('붙임표는 띄어써도 인정',
  score("more and more short-term money", "more and more short term money"), '5/5');

console.log('\n문장부호만으로 된 조각은 채점에서 뺀다');
check('줄표는 세지 않는다 (낱말 9개 중 8개만 채점)',
  score("I'm sorry \u2014 the truth is I was waiting.",
        "i'm sorry the truth is i was waiting"), '8/8');
check('줄표를 그대로 쳐도 만점',
  score("I'm sorry \u2014 the truth is I was waiting.",
        "i'm sorry \u2014 the truth is i was waiting"), '8/8');
check('줄표가 있어도 틀린 낱말은 그대로 잡는다',
  wrong("I'm sorry \u2014 the truth is I was waiting.",
        "i'm sorry the truth is i was walking"),
  ['waiting.']);

console.log('\n틀린 낱말만 표시되는지');
check('한 낱말 틀림',
  wrong("He's an amazing human being on a personal level.",
        "he's an amazing human being on a personal thing"), ['level.']);
check('낱말 하나를 빠뜨려도 뒤가 다 틀리지 않음',
  wrong("You know him publicly, but he is privately as well.",
        "you know him publicly but is privately as well"), ['he']);
check('낱말 하나를 더 써도 뒤가 다 틀리지 않음',
  wrong("Thank you.", "thank you very much"), []);
check('더 쓴 낱말을 따로 알려줌',
  grade("Thank you.", "thank you very much", false).extra, ['very','much']);
check('아무것도 안 쓰면 전부 틀림',
  score("Thank you.", "   "), '0/2');

console.log('\n엄격 모드');
check('대소문자가 틀리면 그 낱말만 오답',
  wrong("Thank you.", "thank you.", true), ['Thank']);
check('문장부호가 빠지면 오답',
  score("Thank you.", "Thank you", true), '1/2');
check('완전히 같으면 만점', score("Thank you.", "Thank you.", true), '2/2');

console.log('');
if (failed) { console.log('실패 ' + failed + '개'); process.exit(1); }
console.log('전부 통과했습니다.');
