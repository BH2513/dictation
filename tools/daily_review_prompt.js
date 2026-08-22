#!/usr/bin/env node
/* 초안을 한 번 더 읽히기 위한 지시문을 표준출력으로 낸다.
   쓰는 법:  node tools/daily_review_prompt.js draft.json */
'use strict';

var fs = require('fs');
var daily = require('./daily');

try {
  if (!process.argv[2]) throw new Error('초안 파일을 알려 주세요.');
  var draft = daily.unwrap(daily.extractJSON(fs.readFileSync(process.argv[2], 'utf8')));
  if (!draft || !Array.isArray(draft.sentences)) throw new Error('초안에 문장이 없습니다.');
  process.stdout.write(daily.buildReviewPrompt(draft, daily.config()));
} catch (e) {
  process.stderr.write('검수 지시문을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
