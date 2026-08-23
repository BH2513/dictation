#!/usr/bin/env node
/* Claude 가 뱉은 것을 검사해서 data/daily/ 에 넣는다.
   쓰는 법:  node tools/daily_save.js out.txt        (또는 표준입력으로 넘겨도 된다)
   검사에 걸리면 아무 파일도 쓰지 않고 1 로 끝낸다 — 반쯤 망가진 문장을 넣느니 건너뛴다. */
'use strict';

var fs = require('fs');
var daily = require('./daily');

function read(cb) {
  var file = null;
  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i].charAt(0) !== '-') { file = process.argv[i]; break; }
  }
  if (file) { cb(fs.readFileSync(file, 'utf8')); return; }
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

    // 묶음은 날짜에 묶지 않는다. 창고에 쌓아 두고 앱이 공부하는 날 꺼내 쓴다
    var r = daily.saveSet(parsed, pids, daily.todayKST());

    process.stdout.write('묶음 ' + r.id + ' \u2014 문장 ' + r.count + '개를 저장했습니다 ('
      + r.profiles.join(', ') + ').\n');
    if (parsed.problems && parsed.problems.length) {
      process.stdout.write('검수에서 고친 것:\n');
      for (var q = 0; q < parsed.problems.length; q++) {
        process.stdout.write('  - ' + parsed.problems[q] + '\n');
      }
    }
    for (var s2 = 0; s2 < parsed.sentences.length; s2++) {
      process.stdout.write('  ' + (s2 + 1) + '. ' + parsed.sentences[s2].text + '\n');
    }
  } catch (e) {
    process.stderr.write('저장하지 못했습니다: ' + e.message + '\n');
    process.exit(1);
  }
});
