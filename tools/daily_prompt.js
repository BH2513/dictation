#!/usr/bin/env node
/* 오늘 Claude 에게 줄 지시문을 표준출력으로 낸다. GitHub Actions 가 부른다.
   사람이 확인하고 싶으면 그냥 `node tools/daily_prompt.js` 로 돌려 보면 된다. */
'use strict';

var daily = require('./daily');

try {
  var cfg = daily.config();
  var pids = daily.profileIds();
  if (!pids.length) throw new Error('data/profiles.json 에 프로필이 없습니다.');

  // 상황과 어휘는 첫 프로필 기준으로 고른다. 문장은 모든 프로필이 함께 쓴다
  var pid = pids[0];
  var sets = cfg.avoidRecentSets || 4;
  var recent = daily.recentSituations(pid, cfg.avoidRecentDays || 14, sets);
  var situations = daily.pickSituations(cfg.situations, recent, cfg.count);
  var vocab = daily.vocabulary(pid, cfg.vocabSample || 30);

  process.stdout.write(daily.buildPrompt({
    count: cfg.count,
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
    situations: situations,
    recent: daily.recentTexts(pid, sets),
    vocab: vocab
  }));
} catch (e) {
  process.stderr.write('지시문을 만들지 못했습니다: ' + e.message + '\n');
  process.exit(1);
}
