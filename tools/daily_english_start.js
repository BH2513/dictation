#!/usr/bin/env node
/* 만드는 단계가 낸 영어(texts)를 오늘 상황과 짝지어 문장 모양으로 세운다.
   상황 목록은 지시문을 만들 때 고른 것을 그대로 받는다 — 순서가 어긋나면 안 된다.
   쓰는 법:  node tools/daily_english_start.js en_out.json situations.json > draft.json */
'use strict';

var fs = require('fs');
var daily = require('./daily');

try {
  if (!process.argv[2] || !process.argv[3]) throw new Error('영어와 상황 목록을 알려 주세요.');
  var out = daily.unwrap(daily.extractJSON(fs.readFileSync(process.argv[2], 'utf8')));
  var situations = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

  var draft = daily.startFromEnglish(situations, out);
  if (!draft) throw new Error('영어 개수가 상황 개수와 맞지 않습니다.');

  process.stdout.write(JSON.stringify(draft));
} catch (e) {
  process.stderr.write('영어를 세우지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
