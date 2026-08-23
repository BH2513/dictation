/* 대화 연습 화면 — ROADMAP 2단계, SPEC 10-b.

   라이브러리 → Talk → 주제 고르기 → 대화 → End → 대화 요약.

   **`app.js` 에 넣지 않고 파일을 따로 뒀다.** 빌드가 없으므로 파일을 나누는 것은 자유롭고,
   `app.js` 는 이미 크다. 여기서 필요한 것은 `attach()` 로 받는다.

   **대화 기록은 기기 안에만 둔다.** 저장소에 안 올린다 — 개인 대화다.
   백업에는 요약만 들어간다 (`store.js` 의 exportAll).

   fetch 와 Promise 를 쓰지 않는다 — 구형 iOS 사파리에서 그대로 돌아야 한다. */
window.TalkUI = (function () {

  var ctx = null;          // app.js 가 넘겨 주는 것 (go, speak …)
  var pid = '';
  var view = 'topics';     // topics | chat | summary
  var talk = null;         // 지금 대화 {id, topic, turns, summary}
  var brain = null;        // 지시문 재료 {topic, misses, recent}
  var company = '';
  var key = '';
  var busy = false;
  var recording = false;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.appendChild(document.createTextNode(text));
    return e;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* **로 감싼 것을 굵게. Daily 의 note 와 같은 규칙 */
  function rich(text) {
    var wrap = el('span', null);
    var bits = String(text || '').split('**');
    for (var i = 0; i < bits.length; i++) {
      if (!bits[i]) continue;
      wrap.appendChild(i % 2 ? el('b', null, bits[i]) : document.createTextNode(bits[i]));
    }
    return wrap;
  }

  function loadJSON(url, done, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', url + (url.indexOf('?') < 0 ? '?t=' : '&t=') + Date.now(), true);
    x.onload = function () {
      if (x.status < 200 || x.status >= 300) { fail(); return; }
      try { done(JSON.parse(x.responseText)); } catch (e) { fail(); }
    };
    x.onerror = function () { fail(); };
    x.send();
  }

  /* ---------------------------------------------------------------- 들어오기 */

  function open(profileId) {
    pid = profileId;
    ctx.show('talk');
    var box = $('talk-body');
    clear(box);
    box.appendChild(el('div', 'notice', 'Loading…'));

    if (!window.Store || !Store.available()) {
      say(box, 'This browser will not let the app save anything, so talk practice cannot run here.', true);
      return;
    }
    Store.getSetting('aiCompany', function (c) {
      company = c || 'anthropic';
      Store.getSetting('aiKey', function (k) {
        key = k || '';
        if (!key) { needKey(); return; }
        view = 'topics';
        drawTopics();
      }, needKey);
    }, needKey);
  }

  function needKey() {
    var box = $('talk-body');
    clear(box);
    box.appendChild(el('div', 'notice',
      'Talk practice needs an AI key on this device. Nothing is spent until one is saved.'));
    var row = el('div', 'buttons');
    var b = el('button', 'primary half', 'Go to Settings');
    b.onclick = function () { ctx.go('#/' + pid + '/settings'); };
    row.appendChild(b);
    box.appendChild(row);
  }

  function say(box, text, bad) {
    clear(box);
    box.appendChild(el('div', 'notice' + (bad ? ' error' : ''), text));
  }

  /* ---------------------------------------------------------------- 주제 고르기 */

  function drawTopics() {
    var box = $('talk-body');
    clear(box);
    box.appendChild(el('div', 'chartlabel', 'What do you want to talk about?'));

    var ul = el('ul', 'list');
    addTopic(ul, 'Free talk', 'Anything. It picks something everyday.', function () {
      pickSituation(function (s) { begin(s || 'anything from your week'); });
    });
    box.appendChild(ul);

    // 오늘 문장 / 영상 대사에서 이어 가기. 없으면 그 줄은 안 그린다
    loadJSON('data/daily/' + pid + '/sets.json', function (rows) {
      if (!rows || !rows.length) return;
      var last = rows[rows.length - 1];
      loadJSON('data/daily/' + pid + '/sets/' + last.id + '.json', function (set) {
        if (!set || !set.sentences || !set.sentences.length) return;
        var one = set.sentences[0];
        addTopic(ul, 'From today’s sentences',
          String(one.text || '').slice(0, 70) + '…',
          function () { begin('this situation: ' + one.text); });
      }, function () {});
    }, function () {});

    loadJSON('data/daily/' + pid + '/index.json', function (rows) {
      if (!rows || !rows.length) return;
      var withShows = null;
      for (var i = 0; i < rows.length; i++) if (rows[i].hasShows) { withShows = rows[i]; break; }
      if (!withShows) return;
      loadJSON('data/daily/' + pid + '/' + withShows.date + '-shows.json', function (day) {
        if (!day || !day.sentences || !day.sentences.length) return;
        var one = day.sentences[0];
        addTopic(ul, 'From a show', String(one.text || '').slice(0, 70) + '…',
          function () { begin('the situation behind this line from a show: ' + one.text); });
      }, function () {});
    }, function () {});
  }

  function addTopic(ul, name, meta, run) {
    var b = el('button', 'item');
    var body = el('div', 'body');
    body.appendChild(el('div', 'name', name));
    body.appendChild(el('div', 'meta', meta));
    b.appendChild(body);
    b.onclick = run;
    var li = document.createElement('li');
    li.appendChild(b);
    ul.appendChild(li);
  }

  /* 상황 목록은 하루 문장이 쓰는 것을 그대로 쓴다. 따로 두면 둘이 어긋난다 */
  function pickSituation(done) {
    loadJSON('data/daily/config.json', function (cfg) {
      var list = (cfg && cfg.situations) || [];
      done(list.length ? list[Math.floor(Math.random() * list.length)] : '');
    }, function () { done(''); });
  }

  /* ---------------------------------------------------------------- 대화 시작 */

  function begin(topic) {
    var box = $('talk-body');
    say(box, 'Getting ready…');

    // 지시문에 실어 보낼 것을 모은다. 하루에 한 번만 새로 만든다 —
    // 이 부분이 바뀌면 캐싱이 처음부터 다시 걸린다 (ROADMAP 비용 절)
    Store.listMisses(pid, function (misses) {
      var byWord = {}, words = [];
      for (var i = 0; i < misses.length; i++) byWord[misses[i].word] = (byWord[misses[i].word] || 0) + 1;
      for (var w in byWord) if (byWord.hasOwnProperty(w)) words.push({ w: w, n: byWord[w] });
      words.sort(function (a, b) { return b.n - a.n; });
      var top = [];
      for (var j = 0; j < words.length && j < 20; j++) top.push(words[j].w);

      Store.listCards(pid, function (cards) {
        var recent = [];
        cards.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        for (var k = 0; k < cards.length && k < 8; k++) {
          if (cards[k].text) recent.push(cards[k].text);
        }
        brain = { topic: topic, misses: top, recent: recent };
        newTalk(topic);
      }, function () { brain = { topic: topic, misses: top, recent: [] }; newTalk(topic); });
    }, function () { brain = { topic: topic, misses: [], recent: [] }; newTalk(topic); });
  }

  /* 대화 번호는 **절대 바뀌면 안 된다** — 문장카드가 그 번호를 가리킨다 */
  function newTalk(topic) {
    Store.listTalks(pid, function (rows) {
      var next = 1;
      for (var i = 0; i < rows.length; i++) if (rows[i].id >= next) next = rows[i].id + 1;
      talk = { key: pid + '|' + next, profileId: pid, id: next, date: Store.today(),
               topic: topic, turns: [], summary: null };
      Store.saveTalk(talk);
      view = 'chat';
      drawChat();
    }, function () {
      talk = { key: pid + '|1', profileId: pid, id: 1, date: Store.today(),
               topic: topic, turns: [], summary: null };
      view = 'chat';
      drawChat();
    });
  }

  /* ---------------------------------------------------------------- 대화 화면 */

  function drawChat() {
    var box = $('talk-body');
    clear(box);

    box.appendChild(el('div', 'chartlabel', 'Talking about: ' + talk.topic));

    for (var i = 0; i < talk.turns.length; i++) box.appendChild(turnBlock(talk.turns[i], i));

    if (!talk.turns.length) {
      box.appendChild(el('div', 'notice',
        'Say something to start. Your sentence gets fixed first, then it replies.'));
    }

    var wrap = el('div', 'talkinput');
    var ta = el('textarea', null);
    ta.id = 'talk-say';
    ta.rows = 2;
    ta.placeholder = 'Type what you want to say, or press Say and talk';
    wrap.appendChild(ta);

    var row = el('div', 'buttons');
    if (window.Recorder && Recorder.canRecord()) {
      var rec = el('button', 'half', recording ? 'Stop' : 'Say');
      rec.id = 'talk-rec';
      rec.onclick = function () { toggleRecord(); };
      row.appendChild(rec);
    }
    var sendBtn = el('button', 'primary half', busy ? 'Waiting…' : 'Send');
    sendBtn.disabled = busy;
    sendBtn.onclick = function () { sendTurn(); };
    row.appendChild(sendBtn);
    wrap.appendChild(row);

    var row2 = el('div', 'buttons');
    var endBtn = el('button', 'half', 'End and get a report');
    endBtn.disabled = busy || !talk.turns.length;
    endBtn.onclick = function () { endTalk(); };
    row2.appendChild(endBtn);
    wrap.appendChild(row2);

    var msg = el('div', null);
    msg.id = 'talk-msg';
    wrap.appendChild(msg);

    box.appendChild(wrap);
    window.scrollTo(0, document.body.scrollHeight);
  }

  function turnBlock(turn, i) {
    var box = el('div', 'turn');

    box.appendChild(el('div', 'turnlabel', 'You said'));
    box.appendChild(el('div', 'said', turn.said));

    // **교정 칸은 따로 그린다.** 안 채워지면 빈 박스가 보인다 — 화면이 한 번 더 막는 자리다
    var fix = el('div', 'fixbox');
    var same = String(turn.corrected || '').replace(/\s+/g, ' ').toLowerCase()
             === String(turn.said || '').replace(/\s+/g, ' ').toLowerCase();
    fix.appendChild(el('div', 'turnlabel', same ? 'Nothing to fix' : 'Fixed'));
    fix.appendChild(el('div', 'fixed', turn.corrected || ''));
    if (turn.natural && turn.natural !== turn.corrected) {
      fix.appendChild(el('div', 'turnlabel', 'More natural'));
      var nat = el('div', 'natural');
      nat.appendChild(rich(turn.natural));
      fix.appendChild(nat);
    }
    if (turn.why) {
      var why = el('div', 'why');
      why.appendChild(rich(turn.why));
      fix.appendChild(why);
    }
    var save = el('button', 'small', 'Save card');
    save.onclick = function () { saveCard(i, save); };
    fix.appendChild(save);
    box.appendChild(fix);

    box.appendChild(el('div', 'turnlabel', 'Reply'));
    var rep = el('div', 'reply', turn.reply);
    box.appendChild(rep);
    return box;
  }

  /* ---------------------------------------------------------------- 보내기 */

  function talkMsg(text, bad) {
    var n = $('talk-msg');
    if (!n) return;
    clear(n);
    if (!text) return;
    n.appendChild(el('div', 'notice' + (bad ? ' error' : ''), text));
  }

  function sendTurn() {
    if (busy) return;
    var ta = $('talk-say');
    var said = String(ta && ta.value || '').replace(/^\s+|\s+$/g, '');
    if (!said) { talkMsg('Type or say something first.', true); return; }

    busy = true;
    drawChat();
    talkMsg('Thinking…');

    Talk.askTurn(company, key, brain, talk.turns, said, function (turn) {
      busy = false;
      turn.said = said;
      talk.turns.push(turn);
      Store.saveTalk(talk);
      drawChat();
      if (ctx.speak) ctx.speak(turn.reply);
    }, function (reason) {
      busy = false;
      // 모양이 틀리면 조용히 한 번 다시 청한다. 두 번 틀리면 그 턴만 건너뛰고 남긴다
      if (reason === 'shape') {
        busy = true;
        drawChat();
        talkMsg('That answer came back in the wrong shape. Trying once more…');
        Talk.askTurn(company, key, brain, talk.turns, said, function (turn2) {
          busy = false;
          turn2.said = said;
          talk.turns.push(turn2);
          Store.saveTalk(talk);
          drawChat();
          if (ctx.speak) ctx.speak(turn2.reply);
        }, function () {
          busy = false;
          drawChat();
          talkMsg('That answer came back wrong twice. Skipping this one — say it again '
            + 'or move on.', true);
          if (ta) ta.value = said;
        });
        return;
      }
      drawChat();
      talkMsg(reasonText(reason), true);
      var again = $('talk-say');
      if (again) again.value = said;      // 쓴 것을 지우지 않는다
    });
  }

  /* 조용히 실패하지 않는다 (SPEC 9). ROADMAP 2단계의 실패 표 그대로 */
  function reasonText(reason) {
    if (reason === 'offline') return 'The connection dropped. Nothing here is lost — '
      + 'press Send again when you are back.';
    if (reason === 'key') return 'The key was refused. Put it in again under Settings.';
    if (reason === 'limit') return 'That is all the account will spend for now.';
    if (reason === 'timeout') return 'No answer came back. Try sending it again.';
    if (reason === 'company') return 'The company is having trouble. Try again in a moment.';
    return 'Something went wrong. Try sending it again.';
  }

  /* ---------------------------------------------------------------- 녹음 */

  function toggleRecord() {
    if (!window.Recorder) return;
    var btn = $('talk-rec');
    if (recording) {
      // 화면 쪽은 답을 기다리지 않고 단추를 먼저 되돌린다 (record.js 의 교훈)
      recording = false;
      if (btn) btn.textContent = 'Say';
      Recorder.stop(function () {
        var heard = Recorder.lastHeard && Recorder.lastHeard();
        var ta = $('talk-say');
        if (heard && ta) ta.value = heard;
        else if (ta && !ta.value) talkMsg('Nothing was picked up. Type it instead.', true);
      });
      return;
    }
    Recorder.start(function () {
      recording = true;
      if (btn) btn.textContent = 'Stop';
      talkMsg('');
    }, function () {
      recording = false;
      if (btn) btn.textContent = 'Say';
      talkMsg('The microphone would not start. Type it instead.', true);
    });
  }

  /* ---------------------------------------------------------------- 문장카드

     **담는 것은 "고친 문장" 이다** — 내가 한 말이 아니라 고쳐진 쪽이다 (ROADMAP). */

  function saveCard(i, btn) {
    var turn = talk.turns[i];
    if (!turn) return;
    Store.addCard(pid, 'talk-' + talk.id, i, 'talk');
    if (btn) { btn.textContent = 'Saved'; btn.disabled = true; }
  }

  /* ---------------------------------------------------------------- 끝내기와 요약 */

  function endTalk() {
    if (busy || !talk.turns.length) return;
    busy = true;
    drawChat();
    talkMsg('Looking back over the whole thing…');

    Talk.askSummary(company, key, brain, talk.turns, function (sum) {
      busy = false;
      talk.summary = sum;
      talk.endedAt = Store.today();
      Store.saveTalk(talk);
      view = 'summary';
      drawSummary();
    }, function (reason) {
      busy = false;
      drawChat();
      talkMsg('Could not make the report. ' + reasonText(reason)
        + ' The conversation is still here.', true);
    });
  }

  function drawSummary() {
    var box = $('talk-body');
    clear(box);
    var s = talk.summary || {};

    box.appendChild(el('div', 'chartlabel', 'Report — ' + talk.turns.length + ' turns'));

    var sum = el('div', 'notice');
    sum.appendChild(el('b', null, 'What you talked about'));
    sum.appendChild(el('div', 'why', s.summary || ''));
    box.appendChild(sum);

    box.appendChild(listBlock('What went well', s.did_well));
    box.appendChild(listBlock('What to fix', s.to_fix));
    if (s.culture && s.culture.length) box.appendChild(listBlock('Not how people say it', s.culture));

    if (s.words && s.words.length) {
      var w = listBlock('Worth keeping', s.words);
      var all = el('button', 'small', 'Save all as cards');
      all.onclick = function () {
        for (var i = 0; i < s.words.length; i++) Store.addCard(pid, 'talk-' + talk.id + '-w', i, 'talk');
        all.textContent = 'Saved';
        all.disabled = true;
      };
      w.appendChild(all);
      box.appendChild(w);
    }

    var row = el('div', 'buttons');
    var back = el('button', 'half', 'Back to the conversation');
    back.onclick = function () { view = 'chat'; drawChat(); };
    var again = el('button', 'primary half', 'New conversation');
    again.onclick = function () { view = 'topics'; drawTopics(); };
    row.appendChild(back);
    row.appendChild(again);
    box.appendChild(row);
    window.scrollTo(0, 0);
  }

  function listBlock(title, items) {
    var b = el('div', 'notice');
    b.appendChild(el('b', null, title));
    var ul = el('ul', 'bullets');
    for (var i = 0; items && i < items.length; i++) {
      var li = document.createElement('li');
      li.appendChild(rich(items[i]));
      ul.appendChild(li);
    }
    b.appendChild(ul);
    return b;
  }

  /* ---------------------------------------------------------------- 바깥에서 쓰는 것 */

  return {
    attach: function (c) { ctx = c; },
    open: open,
    /* 화면을 옮기면 녹음은 버린다 (SPEC 2) */
    leave: function () {
      if (recording && window.Recorder) { Recorder.discard(); recording = false; }
    }
  };
})();
