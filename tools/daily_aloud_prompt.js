#!/usr/bin/env node
/* 만든 영어를 소리내어 읽혀 보기 위한 지시문을 표준출력으로 낸다.
   영어만 보여 준다 — 한국어를 같이 주면 "번역이 맞느냐" 를 보게 된다.
   쓰는 법:  node tools/daily_aloud_prompt.js draft.json */
'use strict';

var fs = require('fs');
var daily = require('./daily');

try {
  if (!process.argv[2]) throw new Error('초안 파일을 알려 주세요.');
  var draft = daily.unwrap(daily.extractJSON(fs.readFileSync(process.argv[2], 'utf8')));
  if (!draft || !Array.isArray(draft.sentences)) throw new Error('초안에 문장이 없습니다.');
  process.stdout.write(daily.buildAloudPrompt(draft));
} catch (e) {
  process.stderr.write('읽기 지시문을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
