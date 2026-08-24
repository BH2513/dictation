#!/usr/bin/env node
/* 붙여 온 재료를 검사해서 data/daily/ 에 넣는다.
   쓰는 법:  node tools/daily_shows_save.js out.json [lines.json] */
'use strict';

var fs = require('fs');
var daily = require('./daily');
var shows = require('./daily_shows');

try {
  if (!process.argv[2]) throw new Error('결과 파일을 알려 주세요.');
  var linesFile = process.argv[3] || process.env.DAILY_LINES || '/tmp/lines.json';
  var lines = JSON.parse(fs.readFileSync(linesFile, 'utf8'));

  var pids = daily.profileIds();
  if (!pids.length) throw new Error('data/profiles.json 에 프로필이 없습니다.');

  var parsed = daily.unwrap(daily.extractJSON(fs.readFileSync(process.argv[2], 'utf8')));
  var problems = shows.validate(parsed, lines, daily.config().count);
  if (problems.length) {
    process.stderr.write('재료가 조건에 맞지 않아 저장하지 않았습니다:\n');
    for (var i = 0; i < problems.length; i++) process.stderr.write('  - ' + problems[i] + '\n');
    process.exit(1);
  }

  var date = process.env.DAILY_DATE || daily.todayKST();
  var was = daily.readJSON(
    require('path').join(daily.DAILY, pids[0], date + '-shows.json'), null);
  var had = (was && was.sentences) ? was.sentences.length : 0;
  var day = shows.save(parsed, lines, date, pids, new Date().toISOString());

  // 덮어쓰는 것이 아니라 붙이는 것이므로, 몇 줄이 늘었는지를 적는다
  process.stdout.write(date + ' 영상 대사 ' + (day.sentences.length - had) + '줄을 더했습니다. '
    + '오늘 모두 ' + day.sentences.length + '줄 (' + pids.join(', ') + ').\n');
  if (parsed.skipped && parsed.skipped.length) {
    process.stdout.write('버린 후보 ' + parsed.skipped.length + '개:\n');
    for (var k = 0; k < parsed.skipped.length; k++) {
      process.stdout.write('  - ' + parsed.skipped[k] + '\n');
    }
  }
  for (var s = 0; s < day.sentences.length; s++) {
    process.stdout.write('  ' + (s + 1) + '. ' + day.sentences[s].text + '\n');
  }
} catch (e) {
  process.stderr.write('저장하지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
