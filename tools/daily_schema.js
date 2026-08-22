#!/usr/bin/env node
/* Claude 에게 강제할 답 형식을 표준출력으로 낸다. GitHub Actions 가 --json-schema 로 넘긴다.
   개수 같은 값은 data/daily/config.json 한 곳에서만 정한다. */
'use strict';

var daily = require('./daily');

try {
  process.stdout.write(JSON.stringify(daily.buildSchema(daily.config())));
} catch (e) {
  process.stderr.write('형식을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
