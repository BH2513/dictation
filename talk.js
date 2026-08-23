/* 대화 연습에서 AI 회사에 말을 거는 부분 — ROADMAP 2단계.

   **서버는 없다.** 폰이 회사에 직접 말을 건다. 열쇠는 이 기기 안에만 있고
   저장소에도 백업에도 안 올라간다.

   **회사마다 어댑터를 따로 쓴다.** 답의 모양을 강제하는 방식도, 브라우저에서 직접
   부를 수 있는지도 회사마다 다르다 (ROADMAP "모델 선택 기준"). 설정 한 줄로
   갈아 끼우려 하면 안 된다.

   지금은 Anthropic 하나만 있다. 브라우저에서 직접 부를 수 있는 것이 확인된 곳이고,
   답의 모양 강제와 캐싱이 같이 되는 것도 확인됐다. 나머지는 어댑터를 더 쓸 때 붙인다.

   fetch 와 Promise 를 쓰지 않는다 — 구형 iOS 사파리에서 그대로 돌아야 한다. */
window.Talk = (function () {

  var TIMEOUT_MS = 30000;   // 답이 안 오면 30초에 끊는다 (ROADMAP 실패 표)

  /* ------------------------------------------------------------------ 회사별 어댑터 */

  var COMPANIES = {
    anthropic: {
      name: 'Anthropic (Claude)',
      keyHint: 'Starts with sk-ant-. Make one at platform.claude.com.',
      model: 'claude-haiku-4-5',
      /* **달러다.** 콘솔(platform.claude.com → Usage)이 달러로 보여 주므로
         같은 단위여야 대조가 된다. 100만 토큰당 값이다.
         캐싱은 다시 읽을 때 0.1배, 처음 넣어 둘 때 1.25배 (5분 유지).
         **값이 바뀌면 여기만 고친다.** */
      price: { input: 1.00, output: 5.00, cacheWrite: 1.25, cacheRead: 0.10 },
      url: 'https://api.anthropic.com/v1/messages',
      headers: function (key) {
        return {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          // 브라우저에서 직접 부르려면 이 줄이 있어야 한다. 열쇠를 기기에 두는
          // 방식(BYOK)을 위해 만든 것이다 — 없으면 CORS 에서 막힌다
          'anthropic-dangerous-direct-browser-access': 'true'
        };
      },
      /* 열쇠가 살아 있는지만 본다. 제일 짧은 요청이다 */
      pingBody: function (model) {
        return {
          model: model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }]
        };
      }
    }
  };

  function company(id) { return COMPANIES[id] || null; }

  function companyList() {
    var out = [];
    for (var k in COMPANIES) {
      if (COMPANIES.hasOwnProperty(k)) out.push({ id: k, name: COMPANIES[k].name, hint: COMPANIES[k].keyHint });
    }
    return out;
  }

  /* ------------------------------------------------------------------ 답의 모양을 강제한다

     **이 단계의 존재 이유다** (ROADMAP 2단계). 답을 자유롭게 쓰게 두면 "내 문장 먼저
     고쳐 줘" 를 한 번 하고 안 한다. 칸을 미리 정해 두면 **비우는 것이 형식에 안 맞아서**
     까먹는 것이 구조적으로 불가능해진다.

     보장되는 것은 "칸이 채워진다" 이지 "교정이 항상 훌륭하다" 가 아니다.
     내 문장이 멀쩡하면 corrected 에 그대로 들어오고 why 가 "고칠 것 없음" 이 된다. */

  var TURN_SCHEMA = {
    type: 'object',
    properties: {
      corrected: { type: 'string' },
      natural: { type: 'string' },
      why: { type: 'string' },
      reply: { type: 'string' }
    },
    required: ['corrected', 'natural', 'why', 'reply'],
    additionalProperties: false
  };

  var SUMMARY_SCHEMA = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      did_well: { type: 'array', items: { type: 'string' } },
      to_fix: { type: 'array', items: { type: 'string' } },
      culture: { type: 'array', items: { type: 'string' } },
      words: { type: 'array', items: { type: 'string' } }
    },
    required: ['summary', 'did_well', 'to_fix', 'culture', 'words'],
    additionalProperties: false
  };

  /* ------------------------------------------------------------------ 지시문

     **대화 안에 넣지 않는다.** 매 요청마다 맨 앞에 다시 붙는 자리에 둔다 —
     대화가 100턴이 돼도 묻힐 자리가 없다.

     **하루에 한 번만 새로 만든다.** 이 부분이 바뀌면 캐싱이 처음부터 다시 걸린다
     (ROADMAP 비용 절). 그리고 **길수록 싸다** — Haiku 4.5 는 앞부분이 4,096 토큰을
     넘어야 캐싱이 걸리므로, 약점과 최근 표현을 실어 보내는 것이 비용을 맞추는 장치다. */

  function systemPrompt(ctx) {
    var lines = [];
    lines.push('You are an English conversation partner for a Korean learner.');
    lines.push('');
    lines.push('Every single turn, you MUST fill all four fields. This is not optional and it');
    lines.push('does not stop applying after a few turns.');
    lines.push('');
    lines.push('- corrected: the same thing they meant, said correctly. It must be a sentence');
    lines.push('  that works on its own — do not patch words one at a time and leave a tangle.');
    lines.push('  Change as little as you can while making it work. If nothing was wrong,');
    lines.push('  repeat what they said.');
    lines.push('- natural: that same meaning again, the way someone would really say it out');
    lines.push('  loud — shorter and more contracted. Keep their meaning. Do NOT turn a');
    lines.push('  statement into a question, and do NOT invent a meaning they did not have.');
    lines.push('- why: one or two short sentences about what actually changed.');
    lines.push('  If nothing needed fixing, say so plainly.');
    lines.push('  Wrap any phrase worth learning in **double asterisks**.');
    lines.push('- reply: your own reply. About 25 to 45 words — this gets read out loud,');
    lines.push('  so long answers are tiring to listen to.');
    lines.push('');
    lines.push('React to what they actually said. Sometimes tell them something about');
    lines.push('yourself or just agree; ask a question back only when you really want to');
    lines.push('know. Asking every single turn turns this into an interview.');
    lines.push('');
    lines.push('Talk like a friend, not a teacher. Use contractions. Keep it casual.');
    lines.push('Do not praise every turn. Do not use emoji.');
    lines.push('');
    lines.push('What reaches you is a speech-to-text transcript. Someone is talking out');
    lines.push('loud into a phone, in real time, in a language they are still learning, and');
    lines.push('they are working the sentence out while they say it.');
    lines.push('');
    lines.push('So it will be rough in ways written English never is. There will be restarts');
    lines.push('and repeated words, because that is what talking sounds like. None of the');
    lines.push('punctuation or capitalisation is theirs. Some of the odd words will be the');
    lines.push('phone mishearing them, some will be their own mistakes, and often you cannot');
    lines.push('tell which.');
    lines.push('');
    lines.push('You do not need to tell which. Judge it as speech, not as writing: would this');
    lines.push('sound wrong coming out of someone\'s mouth in a real conversation? If it');
    lines.push('would, it is worth fixing. If it would go by unnoticed, leave it alone.');
    lines.push('');
    lines.push('If you cannot tell what they meant, put your best single reading in corrected,');
    lines.push('say in why that you were not sure, and ask about it in reply. Do not invent a');
    lines.push('meaning and hand it back as if it were theirs.');

    if (ctx && ctx.topic) {
      lines.push('');
      lines.push('Today you are talking about: ' + ctx.topic);
    }
    if (ctx && ctx.misses && ctx.misses.length) {
      lines.push('');
      lines.push('This learner often gets these words wrong, so watch for them:');
      lines.push(ctx.misses.join(', '));
    }
    if (ctx && ctx.recent && ctx.recent.length) {
      lines.push('');
      lines.push('They recently studied these sentences. Reuse this vocabulary when it fits:');
      for (var i = 0; i < ctx.recent.length; i++) lines.push('- ' + ctx.recent[i]);
    }
    return lines.join('\n');
  }

  function summaryPrompt() {
    return [
      'The conversation is over. Look back at the whole thing and fill in every field.',
      '',
      '- summary: two or three lines on what was talked about.',
      '- did_well: 2 to 3 concrete things. Name the actual sentence or phrase.',
      '  "Good job" on its own is useless.',
      '- to_fix: 2 to 3 things. Prefer mistakes that came up more than once over one-offs.',
      '- culture: places where the English was grammatical but not what someone would',
      '  actually say in that situation. Empty array if there were none.',
      '- words: 3 to 5 expressions worth keeping. Wrap the expression in **double asterisks**.',
      '',
      'Write for a Korean learner. Be specific, not encouraging.'
    ].join('\n');
  }

  /* ------------------------------------------------------------------ 실패를 갈라 놓는다

     조용히 실패하지 않는다 (SPEC 9). 무엇 때문에 안 됐는지를 갈라 두어야
     화면에서 사람 말로 알려 줄 수 있다. 여기서는 갈래만 정하고 문구는 화면이 정한다. */

  function reasonOf(status, body) {
    if (status === 401 || status === 403) return 'key';
    if (status === 429) return 'limit';
    if (status === 400 && /credit|billing|balance/i.test(body || '')) return 'limit';
    if (status === 0) return 'offline';
    if (status >= 500) return 'company';
    return 'unknown';
  }

  /* ------------------------------------------------------------------ 부르기 */

  function send(companyId, key, body, done, fail) {
    var c = company(companyId);
    if (!c) { fail('unknown', 'no such company'); return; }
    if (!key) { fail('key', 'no key'); return; }

    var xhr = new XMLHttpRequest();
    var finished = false;

    function end(ok, a, b) {
      if (finished) return;
      finished = true;
      if (ok) done(a); else fail(a, b);
    }

    try { xhr.open('POST', c.url, true); }
    catch (e) { end(false, 'unknown', 'open failed'); return; }

    var h = c.headers(key);
    for (var name in h) { if (h.hasOwnProperty(name)) xhr.setRequestHeader(name, h[name]); }

    xhr.timeout = TIMEOUT_MS;
    xhr.ontimeout = function () { end(false, 'timeout', 'no answer'); };
    xhr.onerror = function () { end(false, 'offline', 'network'); };
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        var parsed = null;
        try { parsed = JSON.parse(xhr.responseText); }
        catch (e) { end(false, 'unknown', 'bad json'); return; }
        end(true, parsed);
        return;
      }
      end(false, reasonOf(xhr.status, xhr.responseText), xhr.responseText || String(xhr.status));
    };

    try { xhr.send(JSON.stringify(body)); }
    catch (e) { end(false, 'offline', 'send failed'); }
  }

  /* ------------------------------------------------------------------ 바깥에서 쓰는 것 */

  /* ------------------------------------------------------------------ 얼마 들었나

     답에 사용량이 같이 온다. 그걸로 그 자리에서 값을 낸다 —
     **막연한 돈 걱정을 숫자로 바꾸는 것이 이 셈의 목적이다** (2026-08-26 운영자 요청).

     `input_tokens` 는 **캐시에 안 걸린 나머지**다. 캐시에 넣어 둔 것과 다시 읽은 것은
     따로 온다. 그래서 셋을 더해야 실제로 보낸 양이 되고, 겹쳐 세지 않는다. */

  function costOf(companyId, usage) {
    var c = company(companyId);
    if (!c || !c.price || !usage) return 0;
    var p = c.price;
    var n = function (v) { return (typeof v === 'number' && v > 0) ? v : 0; };
    return (
      n(usage.input_tokens) * p.input +
      n(usage.cache_creation_input_tokens) * p.input * p.cacheWrite +
      n(usage.cache_read_input_tokens) * p.input * p.cacheRead +
      n(usage.output_tokens) * p.output
    ) / 1000000;
  }

  /* 달러로 적는다. 아주 작은 값이 0 으로 보이면 안 된다 */
  function money(usd) {
    var v = (typeof usd === 'number' && usd > 0) ? usd : 0;
    if (v === 0) return '$0';
    if (v < 0.001) return '<$0.001';
    if (v < 1) return '$' + v.toFixed(3);
    return '$' + v.toFixed(2);
  }

  /* ------------------------------------------------------------------ 한 턴 주고받기 */

  function askTurn(companyId, key, ctx, history, said, done, fail) {
    var c = company(companyId);
    if (!c) { fail('unknown'); return; }

    var messages = [];
    for (var i = 0; i < history.length; i++) {
      messages.push({ role: 'user', content: history[i].said });
      messages.push({ role: 'assistant', content: JSON.stringify({
        corrected: history[i].corrected, natural: history[i].natural,
        why: history[i].why, reply: history[i].reply
      }) });
    }
    messages.push({ role: 'user', content: said });

    send(companyId, key, {
      model: c.model,
      max_tokens: 1000,
      system: [{ type: 'text', text: systemPrompt(ctx),
                 // 앞부분을 회사가 갖고 있어 준다. 다시 읽을 때 값이 1/10 이 된다
                 cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: TURN_SCHEMA } },
      messages: messages
    }, function (res) {
      var turn = readJSON(res);
      if (!turn) { fail('shape'); return; }
      turn.costUsd = costOf(companyId, res && res.usage);
      done(turn);
    }, fail);
  }

  function askSummary(companyId, key, ctx, history, done, fail) {
    var c = company(companyId);
    if (!c) { fail('unknown'); return; }

    var talk = [];
    for (var i = 0; i < history.length; i++) {
      talk.push('Learner: ' + history[i].said);
      talk.push('You: ' + history[i].reply);
    }

    send(companyId, key, {
      model: c.model,
      max_tokens: 2000,
      system: [{ type: 'text', text: systemPrompt(ctx) }],
      output_config: { format: { type: 'json_schema', schema: SUMMARY_SCHEMA } },
      messages: [{ role: 'user', content: talk.join('\n') + '\n\n' + summaryPrompt() }]
    }, function (res) {
      var sum = readJSON(res);
      if (!sum) { fail('shape'); return; }
      sum.costUsd = costOf(companyId, res && res.usage);
      done(sum);
    }, fail);
  }

  /* 답의 모양을 강제했으므로 첫 글 조각이 통째로 JSON 이다 */
  function readJSON(res) {
    if (!res || !res.content) return null;
    for (var i = 0; i < res.content.length; i++) {
      if (res.content[i].type !== 'text') continue;
      try { return JSON.parse(res.content[i].text); } catch (e) { return null; }
    }
    return null;
  }

  return {
    companies: companyList,
    company: company,
    askTurn: askTurn,
    askSummary: askSummary,
    costOf: costOf,
    money: money,
    systemPrompt: systemPrompt,
    TURN_SCHEMA: TURN_SCHEMA,
    SUMMARY_SCHEMA: SUMMARY_SCHEMA,

    /* 열쇠를 저장하기 전에 실제로 한 번 불러 본다 (ROADMAP "넣을 때 확인한다").
       안 되면 저장하지 않는다 — 안 되는 열쇠를 넣어 두면 대화 도중에야 알게 된다. */
    checkKey: function (companyId, key, done, fail) {
      var c = company(companyId);
      if (!c) { fail('unknown', 'no such company'); return; }
      send(companyId, key, c.pingBody(c.model), function () { done(); }, fail);
    },

    send: send,
    TIMEOUT_MS: TIMEOUT_MS
  };
})();
