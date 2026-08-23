#!/usr/bin/env node
/* 등록한 영상에서 오늘 쓸 대사를 골라, 재료를 붙이라는 지시문을 낸다.
   고른 대사 목록은 --lines 로 준 파일에 같이 적어 둔다 (나중에 대조해야 하므로). */
'use strict';

var fs = require('fs');
var daily = require('./daily');
var shows = require('./daily_shows');

try {
  var cfg = daily.config();
  var pids = daily.profileIds();
  if (!pids.length) throw new Error('data/profiles.json 에 프로필이 없습니다.');
  var pid = pids[0];

  // 어느 영상이 얼마나 내놓는지 로그에 남긴다. 0 줄이면 그 자막이 대사 연습에 못 쓰는 것이다
  var counts = shows.tally(pid, cfg);
  for (var title in counts) {
    if (counts.hasOwnProperty(title)) {
      process.stderr.write('  ' + String(counts[title]).padStart(4) + '줄  ' + title + '\n');
    }
  }

  var all = shows.candidates(pid, cfg);
  if (all.length < cfg.count) {
    throw new Error('등록한 영상에서 쓸 만한 대사가 ' + all.length + '줄뿐입니다. '
      + 'PC 에서 영상을 더 등록해 주세요.');
  }
  // 규칙으로는 길이와 문장부호밖에 못 본다. 후보를 넉넉히 주고 고르는 것은 AI 가 한다
  var pool = (cfg.count || 5) * (cfg.showsCandidates || 6);
  var used = shows.recentLines(pid, cfg.avoidRecentDays || 14);
  var lines = shows.pickLines(all, used, pool);

  var out = process.env.DAILY_LINES || '/tmp/lines.json';
  fs.writeFileSync(out, JSON.stringify(lines, null, 2), 'utf8');

  process.stdout.write(shows.buildPrompt(lines, cfg));
} catch (e) {
  process.stderr.write('대사를 고르지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
