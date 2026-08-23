#!/usr/bin/env node
/* 소리내어 읽은 결과의 답 형식을 표준출력으로 낸다. */
'use strict';

var daily = require('./daily');

try {
  process.stdout.write(JSON.stringify(daily.buildAloudSchema(daily.config())));
} catch (e) {
  process.stderr.write('형식을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
