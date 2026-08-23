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
      keyHint: 'Starts with sk-ant-. Make one at console.anthropic.com.',
      model: 'claude-haiku-4-5',
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

  return {
    companies: companyList,
    company: company,

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
