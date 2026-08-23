#!/usr/bin/env node
/* Claude CLI 가 뱉은 결과에서 "실제로 어떤 모델이 답했는지" 를 꺼내 한 줄로 낸다.
   워크플로 기록에 남겨 두려는 것이다 — 나중에 문장 품질이 달라졌을 때
   모델이 바뀐 탓인지 지시문을 고친 탓인지 바로 알 수 있어야 한다.

   찾지 못하면 아무것도 내지 않고 1 로 끝낸다. 부르는 쪽에서 그것을 보고 알린다. */
'use strict';

var fs = require('fs');

/* CLI 출력 모양이 판마다 조금씩 다르다. 아는 자리를 차례로 보고,
   그래도 없으면 글에서 모델 이름처럼 생긴 것을 찾는다. */
function modelOf(raw) {
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

  if (parsed && parsed.modelUsage && typeof parsed.modelUsage === 'object') {
    var keys = Object.keys(parsed.modelUsage);
    if (keys.length) return keys.join(', ');
  }
  if (parsed && typeof parsed.model === 'string' && parsed.model) return parsed.model;

  var found = String(raw || '').match(/claude[-a-z0-9.]*[0-9][-a-z0-9.]*/i);
  return found ? found[0] : '';
}

if (require.main === module) {
  var file = process.argv[2];
  var raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { process.exit(1); }

  var model = modelOf(raw);
  if (!model) process.exit(1);
  process.stdout.write(model + '\n');
}

module.exports = { modelOf: modelOf };
