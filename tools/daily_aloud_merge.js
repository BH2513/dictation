#!/usr/bin/env node
/* 읽고 고친 영어를 초안에 도로 끼워 표준출력으로 낸다.
   개수나 순서가 어긋나면 아무것도 내지 않고 1 로 끝낸다 — 그때는 초안을 그대로 쓴다.
   쓰는 법:  node tools/daily_aloud_merge.js draft.json aloud.json > polished.json */
'use strict';

var fs = require('fs');
var daily = require('./daily');

function read(file) {
  return daily.unwrap(daily.extractJSON(fs.readFileSync(file, 'utf8')));
}

try {
  if (!process.argv[2] || !process.argv[3]) throw new Error('초안과 읽은 결과를 알려 주세요.');
  var draft = read(process.argv[2]);
  var aloud = read(process.argv[3]);

  var merged = daily.applyAloud(draft, aloud);
  if (!merged) throw new Error('문장 개수가 맞지 않습니다.');

  var changed = (aloud && aloud.changed) || [];
  if (merged.aloudChanged) {
    process.stderr.write('   ' + merged.aloudChanged + '개를 고쳤습니다.\n');
    for (var i = 0; i < changed.length; i++) {
      process.stderr.write('   - ' + changed[i] + '\n');
    }
  } else {
    process.stderr.write('   걸리는 데가 없어 그대로 둡니다.\n');
  }

  delete merged.aloudChanged;
  process.stdout.write(JSON.stringify(merged));
} catch (e) {
  process.stderr.write('읽은 것을 끼우지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
