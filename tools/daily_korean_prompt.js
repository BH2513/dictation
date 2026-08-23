#!/usr/bin/env node
/* 한국어 단계의 지시문을 표준출력으로 낸다.
   쓰는 법:  node tools/daily_korean_prompt.js draft.json */
'use strict';

var fs = require('fs');
var daily = require('./daily');

try {
  if (!process.argv[2]) throw new Error('문장 파일을 알려 주세요.');
  var draft = daily.unwrap(daily.extractJSON(fs.readFileSync(process.argv[2], 'utf8')));
  if (!draft || !Array.isArray(draft.sentences)) throw new Error('문장이 없습니다.');
  process.stdout.write(daily.buildKoreanPrompt(draft));
} catch (e) {
  process.stderr.write('한국어 지시문을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
