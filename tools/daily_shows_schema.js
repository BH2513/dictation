#!/usr/bin/env node
'use strict';
var daily = require('./daily');
var shows = require('./daily_shows');
try {
  process.stdout.write(JSON.stringify(shows.buildSchema(daily.config().count)));
} catch (e) {
  process.stderr.write('형식을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
