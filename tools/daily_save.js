#!/usr/bin/env node
/* Claude 가 뱉은 것을 검사해서 data/daily/ 에 넣는다.
   쓰는 법:  node tools/daily_save.js out.txt        (또는 표준입력으로 넘겨도 된다)
   검사에 걸리면 아무 파일도 쓰지 않고 1 로 끝낸다 — 반쯤 망가진 문장을 넣느니 건너뛴다. */
'use strict';

var fs = require('fs');
var daily = require('./daily');

function read(cb) {
  if (process.argv[2]) { cb(fs.readFileSync(process.argv[2], 'utf8')); return; }
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { buf += d; });
  process.stdin.on('end', function () { cb(buf); });
}

read(function (raw) {
  try {
    var cfg = daily.config();
    var pids = daily.profileIds();
    if (!pids.length) throw new Error('data/profiles.json 에 프로필이 없습니다.');

    var parsed = daily.unwrap(daily.extractJSON(raw));
    var problems = daily.validate(parsed, cfg);
    if (problems.length) {
      process.stderr.write('문장이 조건에 맞지 않아 저장하지 않았습니다:\n');
      for (var i = 0; i < problems.length; i++) process.stderr.write('  - ' + problems[i] + '\n');
      process.exit(1);
    }

    var date = process.env.DAILY_DATE || daily.todayKST();
    var r = daily.save(parsed, date, pids, new Date().toISOString());

    process.stdout.write(date + ' 문장 ' + r.day.sentences.length + '개를 저장했습니다 ('
      + r.profiles.join(', ') + ').\n');
    if (parsed.problems && parsed.problems.length) {
      process.stdout.write('검수에서 고친 것:\n');
      for (var q = 0; q < parsed.problems.length; q++) {
        process.stdout.write('  - ' + parsed.problems[q] + '\n');
      }
    }
    for (var s = 0; s < r.day.sentences.length; s++) {
      process.stdout.write('  ' + (s + 1) + '. ' + r.day.sentences[s].text + '\n');
    }
  } catch (e) {
    process.stderr.write('저장하지 못했습니다: ' + e.message + '\n');
    process.exit(1);
  }
});
