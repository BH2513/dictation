#!/usr/bin/env node
/* 말투 결과를 문장에 끼워 표준출력으로 낸다.
   개수나 순서가 어긋나면 아무것도 내지 않고 1 로 끝낸다.
   쓰는 법:  node tools/daily_alts_merge.js draft.json out.json > merged.json */
'use strict';

var fs = require('fs');
var daily = require('./daily');

function read(file) {
  return daily.unwrap(daily.extractJSON(fs.readFileSync(file, 'utf8')));
}

try {
  if (!process.argv[2] || !process.argv[3]) throw new Error('문장과 결과를 알려 주세요.');
  var merged = daily.applyAlts(read(process.argv[2]), read(process.argv[3]));
  if (!merged) throw new Error('개수가 맞지 않거나 빈 칸이 있습니다.');
  process.stdout.write(JSON.stringify(merged));
} catch (e) {
  process.stderr.write('말투를 끼우지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
