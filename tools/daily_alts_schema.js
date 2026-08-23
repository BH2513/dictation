#!/usr/bin/env node
/* 말투 단계의 답 형식을 표준출력으로 낸다. */
'use strict';

var daily = require('./daily');

try {
  process.stdout.write(JSON.stringify(daily.buildAltsSchema(daily.config())));
} catch (e) {
  process.stderr.write('형식을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
