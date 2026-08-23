/* 대화 연습 화면 — ROADMAP 2단계, SPEC 10-b.

   라이브러리 → Talk → 주제 고르기 → 대화 → End → 대화 요약.

   **`app.js` 에 넣지 않고 파일을 따로 뒀다.** 빌드가 없으므로 파일을 나누는 것은 자유롭고,
   `app.js` 는 이미 크다. 여기서 필요한 것은 `attach()` 로 받는다.

   **대화 기록은 기기 안에만 둔다.** 저장소에 안 올린다 — 개인 대화다.
   백업에는 요약만 들어간다 (`store.js` 의 exportAll).

   fetch 와 Promise 를 쓰지 않는다 — 구형 iOS 사파리에서 그대로 돌아야 한다. */
window.TalkUI = (function () {

  var ctx = null;          // app.js 가 넘겨 주는 것 (go, show)
  var pid = '';
  var view = 'topics';     // topics | chat | summary
  var talk = null;         // 지금 대화 {id, topic, turns, summary}
  var brain = null;        // 지시문 재료 {topic, misses, recent}
  var company = '';
  var key = '';

  /* **말하면 알아서 도는 고리** (2026-08-26 운영자 지적).
     처음에는 `Say` 단추를 눌러 말하고 `Send` 를 눌러 보냈는데, 그러면 대화가 아니라
     서식 채우기가 된다. 이제 단추 없이 돈다:

       듣는다 → 말이 멎으면 저절로 보낸다 → 답을 소리로 읽는다 → 다시 듣는다

     **녹음기를 켜지 않는다.** 대화는 소리를 저장하지 않으므로 음성인식만 있으면 되고,
     그래야 아이폰에서 녹음기와 음성인식이 마이크를 다투는 일이 아예 없다
     (`record.js` 에 적어 둔 그 문제다). 그래서 여기서는 `Recorder` 를 안 쓴다. */
  var mode = 'idle';       // idle | listening | thinking | speaking
  var hear = null;         // 음성인식기
  var hearGen = 0;         // 늦게 오는 알림을 버리는 표
  var quiet = null;        // 말이 멎었는지 재는 시계
  var saidFinal = '';      // 받아적힌 것 (확정)
  var saidNow = '';        // 받아적히는 중
  var typing = false;      // 타이핑 칸을 펴 뒀나
  var micNote = '';        // 마이크가 안 될 때 남기는 말

  /* **얼마나 기다렸다 보낼까** (2026-08-26 운영자 지적).
     1.5초로 뒀더니 **생각하는 사이에 잘라 보냈다.** 영어를 짜맞추는 사람은 문장 한가운데서
     멈춘다 — 원어민 기준으로 재면 안 된다.

     그리고 **기다리는 값을 하나로 두면 안 된다.** 말이 끝난 것 같으면 짧게, 아직 이어질
     것 같으면 길게 기다린다. 어느 쪽으로 틀릴지도 정해 두었다 —
     **너무 오래 기다리는 것은 조금 답답할 뿐이지만, 잘라 버리면 대화가 깨진다.**
     그래서 헷갈리면 기다리는 쪽으로 기운다. */
  var QUIET_MS = 2500;     // 말이 끝난 것 같을 때
  var CARRY_MS = 2500;     // 아직 이어질 것 같으면 이만큼 더

  /* 이런 낱말로 끝나면 아직 말하는 중이다. 실제로 "It's kind of a" 에서 잘린 적이 있다 —
     `a` 로 끝났으니 뒤에 말이 더 있는 게 뻔했다. */
  var CARRY_ON = (' a an the my your his her its our their this that these those'
    + ' and but or so because if when while although though since than'
    + ' to of in on at for with about from by into over under after before'
    + ' is are was were am be been being have has had do does did'
    + ' will would can could should might must shall may'
    + ' i you he she it we they there here'
    + ' very really just kind sort going want need try like about'
    + ' more most much many some any every not').split(' ');

  function stillGoing(text) {
    var t = String(text || '').replace(/\s+$/, '');
    if (!t) return true;
    if (/[,;:\-]$/.test(t)) return true;              // 쉼표로 끝나면 이어진다
    var m = t.toLowerCase().match(/([a-z']+)[^a-z']*$/);
    if (!m) return false;
    for (var i = 0; i < CARRY_ON.length; i++) if (CARRY_ON[i] === m[1]) return true;
    return false;
  }

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

  /* ---------------------------------------------------------------- 듣기와 말하기 */

  function canHear() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function canSpeak() {
    return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  function stopQuiet() { if (quiet) { clearTimeout(quiet); quiet = null; } }

  function stopHearing() {
    hearGen++;
    stopQuiet();
    if (hear) { try { hear.abort(); } catch (e) { try { hear.stop(); } catch (e2) {} } }
    hear = null;
  }

  /* 듣기 시작. 사파리는 continuous 를 흘려버리고 저 혼자 끝내는 일이 잦아서,
     끝났다는 알림이 오면 **아직 듣는 중이면 다시 켠다.** */
  function startHearing() {
    if (!canHear()) { micNote = 'no-mic'; return; }
    stopHearing();
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mine = ++hearGen;
    var r;
    try { r = new Ctor(); } catch (e) { micNote = 'no-mic'; paint(); return; }

    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = function (e) {
      if (mine !== hearGen) return;
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var t = e.results[i][0].transcript;
        if (e.results[i].isFinal) saidFinal += (saidFinal ? ' ' : '') + t.replace(/^\s+|\s+$/g, '');
        else interim += t;
      }
      saidNow = interim.replace(/^\s+|\s+$/g, '');
      paintLive();
      // 말이 이어지는 동안에는 계속 미룬다. 멎어야 보낸다
      stopQuiet();
      var heardSoFar = (saidFinal + ' ' + saidNow).replace(/\s+/g, ' ');
      var wait = stillGoing(heardSoFar) ? QUIET_MS + CARRY_MS : QUIET_MS;
      armBar(wait);
      quiet = setTimeout(function () { if (mine === hearGen) sendHeard(); }, wait);
    };

    r.onerror = function (e) {
      if (mine !== hearGen) return;
      var what = e && e.error;
      if (what === 'no-speech' || what === 'aborted') return;   // 그냥 조용한 것뿐이다
      if (what === 'not-allowed' || what === 'service-not-allowed') {
        micNote = 'denied';
        mode = 'idle';
        stopHearing();
        paint();
        return;
      }
      micNote = 'failed';
    };

    r.onend = function () {
      if (mine !== hearGen) return;
      // 저 혼자 끝났다. 아직 들을 차례면 다시 켠다
      if (mode === 'listening') { try { r.start(); } catch (e) { stopHearing(); mode = 'idle'; paint(); } }
    };

    try { r.start(); }
    catch (e) { micNote = 'failed'; mode = 'idle'; paint(); return; }
    hear = r;
    micNote = '';
  }

  function listen() {
    if (!canHear()) return;
    saidFinal = '';
    saidNow = '';
    mode = 'listening';
    startHearing();
    paint();
  }

  /* 답을 소리로 읽고, 다 읽으면 다시 듣는다.
     **읽는 동안에는 마이크를 닫는다** — 안 그러면 제 목소리를 받아적는다. */
  function speakThenListen(text) {
    if (!canSpeak()) { if (canHear()) listen(); else { mode = 'idle'; paint(); } return; }
    mode = 'speaking';
    paint();
    var done = false;
    function after() {
      if (done) return;
      done = true;
      if (mode !== 'speaking') return;      // 사람이 그새 멈췄다
      if (canHear()) listen(); else { mode = 'idle'; paint(); }
    }
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.onend = after;
      u.onerror = after;
      window.speechSynthesis.speak(u);
      // 다 읽었다는 알림이 안 오는 기기가 있다. 글자 길이로 어림잡아 한 번 더 받는다
      setTimeout(after, Math.min(30000, 2000 + text.length * 70));
    } catch (e) { after(); }
  }

  function hush() {
    stopHearing();
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    if (mode !== 'thinking') mode = 'idle';
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

  /* ---------------------------------------------------------------- 대화 화면

     단추로 굴리지 않는다. 말하면 듣고, 멎으면 보내고, 답을 읽고, 다시 듣는다.
     사람이 누를 것은 **멈추기와 끝내기 둘뿐**이다. */

  function drawChat() {
    var box = $('talk-body');
    clear(box);

    var head = el('div', 'talkhead');
    head.appendChild(el('span', 'chartlabel', talk.topic));
    var n = fixedCount();
    if (n) head.appendChild(el('span', 'fixcount', n + (n === 1 ? ' fix' : ' fixes')));
    box.appendChild(head);

    var log = el('div', null);
    log.id = 'talk-log';
    for (var i = 0; i < talk.turns.length; i++) log.appendChild(turnBlock(talk.turns[i], i));
    box.appendChild(log);

    var live = el('div', null);
    live.id = 'talk-live';
    box.appendChild(live);

    box.appendChild(controls());

    var msg = el('div', null);
    msg.id = 'talk-msg';
    box.appendChild(msg);

    paintLive();
    if (micNote) talkMsg(micText(), true);
    scrollDown();
  }

  /* 화면을 통째로 다시 그리지 않고 살아 있는 부분만 손본다 —
     듣는 중에 다시 그리면 글자가 깜빡이고 타이핑 칸의 커서가 튄다 */
  function paint() {
    if (view !== 'chat' || !$('talk-body')) return;
    var c = $('talk-controls');
    if (!c) { drawChat(); return; }
    c.parentNode.replaceChild(controls(), c);
    paintLive();
  }

  /* 살아 있는 칸. **통째로 다시 그리지 않는다** — 말하는 중에 다시 그리면 글자가 깜빡이고
     차오르던 바가 처음으로 돌아간다. 글자와 옷만 갈아 끼운다. */
  function paintLive() {
    var n = $('talk-live');
    if (!n) return;
    if (mode !== 'listening' && mode !== 'thinking') { clear(n); return; }

    var body = n.querySelector('.live');
    if (!body) {
      clear(n);
      var hold = el('button', 'livebox');
      body = el('div', 'live');
      hold.appendChild(body);
      var track = el('div', 'bar');
      var fill = el('div', 'fill');
      fill.id = 'talk-bar';
      track.appendChild(fill);
      hold.appendChild(track);
      hold.appendChild(el('div', 'barhint', 'Take your time. Tap here when you are done.'));
      // 다 말했으면 기다릴 것 없이 바로 보낸다
      hold.onclick = function () { if (mode === 'listening') sendHeard(); };
      n.appendChild(hold);
    }

    var text = (saidFinal + ' ' + saidNow).replace(/^\s+|\s+$/g, '');
    if (mode === 'thinking') {
      body.className = 'live said';
      body.textContent = text || '\u2026';
      var b0 = $('talk-bar');
      if (b0) { b0.style.transition = 'none'; b0.style.width = '0%'; }
      scrollDown();
      return;
    }
    body.className = 'live' + (text ? ' said' : ' waiting');
    body.textContent = text || 'Listening \u2014 just start talking.';
    scrollDown();
  }

  /* 조용해진 순간부터 바가 차오른다. 차오르는 동안 말을 이으면 처음으로 돌아간다 */
  function armBar(ms) {
    var bar = $('talk-bar');
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth;          // 이 줄이 없으면 브라우저가 두 값을 합쳐 버려 바가 안 움직인다
    bar.style.transition = 'width ' + ms + 'ms linear';
    bar.style.width = '100%';
  }

  function scrollDown() {
    try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
  }

  function fixedCount() {
    var n = 0;
    for (var i = 0; i < talk.turns.length; i++) if (!nothingToFix(talk.turns[i])) n++;
    return n;
  }

  function controls() {
    var wrap = el('div', 'talkctl');
    wrap.id = 'talk-controls';

    var row = el('div', 'buttons');
    var big;
    if (mode === 'listening') {
      big = el('button', 'primary listening', 'Listening — tap to pause');
      big.onclick = function () { hush(); paint(); };
    } else if (mode === 'thinking') {
      big = el('button', 'primary', 'Thinking…');
      big.disabled = true;
    } else if (mode === 'speaking') {
      big = el('button', 'primary', 'Speaking — tap to skip');
      big.onclick = function () {
        if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
        if (canHear()) listen(); else { mode = 'idle'; paint(); }
      };
    } else {
      big = el('button', 'primary', canHear()
        ? (talk.turns.length ? 'Keep talking' : 'Start talking') : 'Type instead');
      big.onclick = function () { if (canHear()) listen(); else { typing = true; paint(); } };
    }
    row.appendChild(big);
    wrap.appendChild(row);

    // 타이핑은 남겨 둔다 — 조용한 데서 하거나 마이크가 안 될 때 쓴다
    if (typing || !canHear()) {
      var ta = el('textarea', null);
      ta.id = 'talk-say';
      ta.rows = 2;
      ta.placeholder = 'Type it instead';
      wrap.appendChild(ta);
      var row2 = el('div', 'buttons');
      var sendBtn = el('button', 'half', 'Send');
      sendBtn.disabled = (mode === 'thinking');
      sendBtn.onclick = function () {
        var v = String(ta.value || '').replace(/^\s+|\s+$/g, '');
        if (!v) { talkMsg('Type something first.', true); return; }
        hush();
        ask(v);
      };
      row2.appendChild(sendBtn);
      var endBtn = el('button', 'half', 'End and get a report');
      endBtn.disabled = (mode === 'thinking') || !talk.turns.length;
      endBtn.onclick = function () { endTalk(); };
      row2.appendChild(endBtn);
      wrap.appendChild(row2);
    } else {
      var row3 = el('div', 'buttons');
      var typeBtn = el('button', 'half', 'Type instead');
      typeBtn.onclick = function () { typing = true; hush(); paint(); };
      row3.appendChild(typeBtn);
      var endBtn2 = el('button', 'half', 'End and get a report');
      endBtn2.disabled = (mode === 'thinking') || !talk.turns.length;
      endBtn2.onclick = function () { endTalk(); };
      row3.appendChild(endBtn2);
      wrap.appendChild(row3);
    }
    return wrap;
  }

  function micText() {
    if (micNote === 'denied') return 'The microphone is blocked for this site. '
      + 'Allow it in the browser settings, or type instead.';
    if (micNote === 'no-mic') return 'This browser cannot listen, so type instead.';
    return 'The microphone stopped. Tap to start again, or type instead.';
  }

  /* 고칠 것이 없었나. 있으면 크게, 없으면 작게 그린다 —
     할 말이 없는데 큰 상자가 떠 있으면 기계처럼 느껴진다 (2026-08-26 운영자 지적) */
  function nothingToFix(turn) {
    function flat(t) { return String(t || '').replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, ' ')
      .toLowerCase().replace(/^ | $/g, ''); }
    return flat(turn.corrected) === flat(turn.said);
  }

  function turnBlock(turn, i) {
    var box = el('div', 'turn');

    box.appendChild(el('div', 'said', turn.said));

    if (nothingToFix(turn)) {
      // 고칠 것이 없으면 한 줄로. 눌러야 더 자연스러운 말이 펴진다
      var ok = el('button', 'okline', '\u2713 nothing to fix');
      ok.onclick = function () {
        var open = box.querySelector('.fixbox');
        if (open) { box.removeChild(open); return; }
        box.insertBefore(fixBox(turn, i, true), ok.nextSibling);
      };
      box.appendChild(ok);
    } else {
      box.appendChild(fixBox(turn, i, false));
    }

    var rep = el('div', 'reply', turn.reply);
    box.appendChild(rep);
    return box;
  }

  function fixBox(turn, i, quietly) {
    var fix = el('div', 'fixbox' + (quietly ? ' soft' : ''));
    if (!quietly) {
      fix.appendChild(el('div', 'turnlabel', 'Fixed'));
      fix.appendChild(el('div', 'fixed', turn.corrected || ''));
    }
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
    return fix;
  }

  /* ---------------------------------------------------------------- 보내기 */

  function talkMsg(text, bad) {
    var n = $('talk-msg');
    if (!n) return;
    clear(n);
    if (!text) return;
    n.appendChild(el('div', 'notice' + (bad ? ' error' : ''), text));
  }

  /* 말이 멎었다. 받아적힌 것을 보낸다 */
  function sendHeard() {
    stopQuiet();
    var said = (saidFinal + ' ' + saidNow).replace(/\s+/g, ' ').replace(/^ | $/g, '');
    if (!said) return;                       // 아무 말도 안 했다. 계속 듣는다
    stopHearing();
    ask(said);
  }

  function ask(said) {
    if (mode === 'thinking') return;
    mode = 'thinking';
    saidFinal = said;
    saidNow = '';
    paint();
    talkMsg('');

    var ta = $('talk-say');
    if (ta) ta.value = '';

    Talk.askTurn(company, key, brain, talk.turns, said, function (turn) {
      turn.said = said;
      talk.turns.push(turn);
      Store.saveTalk(talk);
      saidFinal = '';
      drawChat();
      speakThenListen(turn.reply);
    }, function (reason) {
      // 모양이 틀리면 조용히 한 번 다시 청한다. 두 번 틀리면 그 턴만 건너뛴다
      if (reason === 'shape') {
        talkMsg('That came back in the wrong shape. Trying once more\u2026');
        Talk.askTurn(company, key, brain, talk.turns, said, function (turn2) {
          turn2.said = said;
          talk.turns.push(turn2);
          Store.saveTalk(talk);
          saidFinal = '';
          drawChat();
          speakThenListen(turn2.reply);
        }, function () { stumble(said, 'shape2'); });
        return;
      }
      stumble(said, reason);
    });
  }

  /* 넘어졌다. **말한 것을 지우지 않는다** — 타이핑 칸에 넣어 두고 다시 보낼 수 있게 한다 */
  function stumble(said, reason) {
    mode = 'idle';
    typing = true;
    drawChat();
    var ta = $('talk-say');
    if (ta) ta.value = said;
    talkMsg(reasonText(reason), true);
  }

  /* 조용히 실패하지 않는다 (SPEC 9). ROADMAP 2단계의 실패 표 그대로 */
  function reasonText(reason) {
    if (reason === 'offline') return 'The connection dropped. What you said is still here — '
      + 'press Send when you are back.';
    if (reason === 'key') return 'The key was refused. Put it in again under Settings.';
    if (reason === 'limit') return 'That is all the account will spend for now.';
    if (reason === 'timeout') return 'No answer came back. Press Send to try again.';
    if (reason === 'company') return 'The company is having trouble. Try again in a moment.';
    if (reason === 'shape2') return 'That came back wrong twice. Send it again, or move on.';
    return 'Something went wrong. Press Send to try again.';
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
    if (mode === 'thinking' || !talk.turns.length) return;
    hush();                                   // 마이크와 목소리를 먼저 끈다
    mode = 'thinking';
    drawChat();
    talkMsg('Looking back over the whole thing\u2026');

    Talk.askSummary(company, key, brain, talk.turns, function (sum) {
      mode = 'idle';
      talk.summary = sum;
      talk.endedAt = Store.today();
      Store.saveTalk(talk);
      view = 'summary';
      drawSummary();
    }, function (reason) {
      mode = 'idle';
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
    /* 화면을 옮기면 마이크와 목소리를 끈다. 안 그러면 다른 화면에서 계속 들린다 */
    leave: function () { hush(); }
  };
})();
