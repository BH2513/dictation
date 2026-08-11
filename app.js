/* 받아쓰기 연습 — 프로필 선택 / 라이브러리 / 듣기.
   빌드 단계가 없으므로 구형 사파리에서 그대로 돌아가야 한다. var 와 함수 선언으로 쓴다. */
(function () {
  // SPEC 4-1: lead-in. 자동자막은 문장 시작을 늦게 잡을 때가 있어 조절할 수 있어야 한다
  var lead = 0.6;           // 초. 듣기 화면 슬라이더로 바꾼다
  var TAIL = 0.3;           // 끝 여유. 마지막 단어가 잘리지 않게 (초)
  var TICK_MS = 40;         // 끝 지점 감시 주기
  var STOP_MARGIN = 0.04;   // 감시 주기로 인한 정지 지연 보정

  var profiles = [];
  var profile = null;
  var profileId = null;     // 주소로 바로 들어오면 profile 이 아직 없다. 기록에는 이 값을 쓴다
  var videos = [];
  var video = null;
  var current = -1;
  var slow = false;
  var strict = false;       // SPEC 6: 기본은 관대 모드
  var audioOnly = false;    // 화면을 덮고 소리만 듣는다
  var checked = false;
  var progress = null;      // 지금 영상의 진도 (SPEC 4-2)
  var recording = false;
  var hintAt = 0;           // 0 없음 → 1 낱말 수 → 2 첫 글자 → 3 정답

  var player = null;
  var apiReady = false;
  var playerReady = false;
  var watchTimer = null;
  var targetEnd = null;
  var startedAt = 0;
  var wantPlay = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.appendChild(document.createTextNode(text));
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function say(msg) {
    var s = $('status');
    if (s) s.textContent = msg;
  }

  /* ---------------------------------------------------------------- 자료 읽기 */

  function getJSON(url, ok, fail) {
    var req = new XMLHttpRequest();
    // 방금 등록한 영상이 바로 보여야 하므로 캐시를 피한다
    req.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + (new Date()).getTime(), true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      if (req.status === 200) {
        var data;
        try {
          data = JSON.parse(req.responseText);
        } catch (e) {
          fail("Couldn't read that file.");
          return;
        }
        ok(data);
      } else if (req.status === 404) {
        fail('missing');
      } else {
        fail("Couldn't load it. Check your internet connection.");
      }
    };
    req.onerror = function () { fail("Couldn't load it. Check your internet connection."); };
    req.send();
  }

  function notice(box, message, isError) {
    clear(box);
    var n = el('div', 'notice' + (isError ? ' error' : ''));
    var lines = message.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i) n.appendChild(document.createElement('br'));
      n.appendChild(document.createTextNode(lines[i]));
    }
    box.appendChild(n);
  }

  /* ---------------------------------------------------------------- 화면 이동 */

  function show(name) {
    var all = ['profiles', 'library', 'listen', 'report', 'cards', 'edit'];
    for (var i = 0; i < all.length; i++) {
      $('screen-' + all[i]).className = 'screen' + (all[i] === name ? ' on' : '');
    }
    $('navbar').style.display = (name === 'listen') ? 'flex' : 'none';
    window.scrollTo(0, 0);
  }

  function go(hash) {
    if (window.location.hash === hash) route();
    else window.location.hash = hash;
  }

  function route() {
    var parts = window.location.hash.replace(/^#\/?/, '').split('/');
    var profileId = parts[0] || '';
    var videoId = parts[1] || '';

    stopWatch();

    if (!profileId) { showProfiles(); return; }
    if (!videoId) { showLibrary(profileId); return; }
    if (videoId === 'report') { showReport(profileId); return; }
    if (videoId === 'cards') { showCards(profileId, parts[2] || ''); return; }
    if (videoId === 'edit') { showEdit(profileId, parts[2] || ''); return; }
    showListen(profileId, videoId, parts[2] ? parseInt(parts[2], 10) : null);
  }

  /* ---------------------------------------------------------------- 프로필 선택 */

  function showProfiles() {
    show('profiles');
    var box = $('profile-list');
    notice(box, 'Loading\u2026');

    getJSON('data/profiles.json', function (data) {
      profiles = data || [];
      clear(box);
      if (!profiles.length) {
        notice(box, 'Nobody here yet.\nAdd a video from your PC and a profile appears.');
        return;
      }
      var ul = el('ul', 'list');
      for (var i = 0; i < profiles.length; i++) {
        (function (p) {
          var b = el('button', 'item');
          var dot = el('div', 'dot', (p.name || '?').charAt(0));
          dot.style.background = p.color || '#3b82f6';
          var body = el('div', 'body');
          body.appendChild(el('div', 'name', p.name));
          b.appendChild(dot);
          b.appendChild(body);
          b.onclick = function () { go('#/' + p.id); };
          var li = document.createElement('li');
          li.appendChild(b);
          ul.appendChild(li);
        })(profiles[i]);
      }
      box.appendChild(ul);
    }, function (why) {
      notice(box, why === 'missing'
        ? 'Nobody here yet.\nAdd a video from your PC and a profile appears.'
        : why, why !== 'missing');
    });
  }

  /* ---------------------------------------------------------------- 라이브러리 */

  function findProfile(id, done) {
    if (profiles.length) {
      for (var i = 0; i < profiles.length; i++) {
        if (profiles[i].id === id) { done(profiles[i]); return; }
      }
      done(null);
      return;
    }
    getJSON('data/profiles.json', function (data) {
      profiles = data || [];
      findProfile(id, done);
    }, function () { done(null); });
  }

  function showLibrary(profileId) {
    setProfileId(profileId);
    show('library');
    var box = $('video-list');
    notice(box, 'Loading\u2026');

    findProfile(profileId, function (p) {
      profile = p;
      $('library-title').textContent = p ? p.name : 'Library';

      getJSON('data/videos/' + profileId + '/index.json', function (data) {
        videos = data || [];
        clear(box);
        if (!videos.length) {
          notice(box, 'No videos yet.\nAdd one from your PC and it shows up here.');
          return;
        }
        var ul = el('ul', 'list');
        for (var i = 0; i < videos.length; i++) {
          (function (v) {
            var b = el('button', 'item');
            var body = el('div', 'body');
            body.appendChild(el('div', 'name', v.title || v.videoId));
            var meta = (v.sentenceCount || 0) + ' sentences';
            if (v.hasKorean) meta += ' \u00b7 Korean';
            if (v.addedAt) meta += ' · ' + v.addedAt;
            body.appendChild(el('div', 'meta', meta));
            if (v.source === 'auto_captions') {
              body.appendChild(el('span', 'badge', 'Auto captions \u2014 sentence breaks may be off'));
            }
            b.appendChild(body);
            b.onclick = function () { go('#/' + profileId + '/' + v.videoId); };
            var ed = el('button', 'small edit-link', 'Edit');
            ed.onclick = function (e) {
              (e || window.event).stopPropagation();
              go('#/' + profileId + '/edit/' + v.videoId);
              return false;
            };
            b.appendChild(ed);
            var li = document.createElement('li');
            li.appendChild(b);
            ul.appendChild(li);
          })(videos[i]);
        }
        box.appendChild(ul);
      }, function (why) {
        notice(box, why === 'missing'
          ? 'No videos yet.\nAdd one from your PC and it shows up here.'
          : why, why !== 'missing');
      });
    });
  }

  /* ---------------------------------------------------------------- 듣기 */

  function showListen(pid, videoId, jumpTo) {
    var profileId = pid;
    setProfileId(pid);
    show('listen');
    current = -1;
    video = null;
    $('listen-title').textContent = 'Loading\u2026';
    $('back-to-library').onclick = function () { go('#/' + profileId); };
    clear($('sentence-list'));
    $('now').textContent = '';
    say('');

    getJSON('data/videos/' + profileId + '/' + videoId + '.json', function (data) {
      video = data;
      $('listen-title').textContent = data.title || videoId;
      $('auto-note').style.display = (data.source === 'auto_captions') ? 'block' : 'none';
      drawSentences();
      ensurePlayer(videoId);
      if (!video.sentences || !video.sentences.length) {
        say('This video has no sentences.');
        return;
      }
      loadProgress(profileId, videoId, function (at) {
        if (jumpTo !== null && jumpTo >= 0 && jumpTo < video.sentences.length) at = jumpTo;
        select(at, false);
        if (at > 0) say('Picking up at sentence ' + (at + 1) + '.');
      });
    }, function (why) {
      notice($('sentence-list'), why === 'missing'
        ? "Couldn't find the sentences for this video."
        : why, true);
      $('listen-title').textContent = "Couldn't load";
    });
  }

  function toggleList(open) {
    var box = $('sentence-list');
    var on = (open === undefined) ? (box.style.display === 'none') : open;
    box.style.display = on ? 'block' : 'none';
    $('list-btn').textContent = on ? 'Hide sentences' : 'Sentences (' + listLength() + ')';
    if (on) scrollListTo(current);
  }

  function listLength() {
    return ((video && video.sentences) || []).length;
  }

  function scrollListTo(idx) {
    var box = $('sentence-list');
    var item = $('sentence-' + idx);
    if (!item || box.style.display === 'none') return;
    var top = item.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - item.offsetHeight) {
      box.scrollTop = Math.max(0, top - 20);
    }
  }

  function drawSentences() {
    var box = $('sentence-list');
    clear(box);
    box.style.display = 'none';
    var list = video.sentences || [];
    $('list-btn').textContent = 'Sentences (' + list.length + ')';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < list.length; i++) {
      (function (s, idx) {
        var b = el('button', 'sentence');
        b.id = 'sentence-' + idx;
        b.appendChild(el('span', 'no', (idx + 1) + '.'));
        b.appendChild(document.createTextNode(s.text));
        b.onclick = function () { toggleList(false); select(idx, true); };
        var li = document.createElement('li');
        li.appendChild(b);
        frag.appendChild(li);
      })(list[i], i);
    }
    var ul = el('ul', 'list');
    ul.appendChild(frag);
    box.appendChild(ul);
    markDone();
  }

  function select(idx, play) {
    var list = (video && video.sentences) || [];
    if (idx < 0 || idx >= list.length) return;

    var old = $('sentence-' + current);
    if (old) old.className = 'sentence';
    current = idx;
    var now = $('sentence-' + current);
    if (now) now.className = 'sentence playing';
    scrollListTo(current);
    $('position').textContent = (idx + 1) + ' / ' + list.length;
    $('position2').textContent = (idx + 1) + ' / ' + list.length;

    resetAnswer();

    $('prev-btn').disabled = (idx === 0);
    $('next-btn').disabled = (idx === list.length - 1);

    if (progress && window.Store && Store.available()) {
      progress.at = current;
      Store.saveProgress(progress, noteStorage);
    }
    if (play) playCurrent();
    else say('Press Play, then type what you hear.');
  }


  /* ---------------------------------------------------------------- 채점 */

  // 관대 모드에서 같은 말로 볼 축약형. 애매한 소유격('Bill's)은 넣지 않는다.
  var EXPAND = {
    "i'm": "i am", "i've": "i have", "i'll": "i will", "i'd": "i would",
    "it's": "it is", "that's": "that is", "there's": "there is", "here's": "here is",
    "what's": "what is", "who's": "who is", "he's": "he is", "she's": "she is",
    "let's": "let us", "we're": "we are", "you're": "you are", "they're": "they are",
    "we'll": "we will", "you'll": "you will", "they'll": "they will",
    "we've": "we have", "you've": "you have", "they've": "they have",
    "don't": "do not", "doesn't": "does not", "didn't": "did not",
    "can't": "cannot", "won't": "will not", "wouldn't": "would not",
    "couldn't": "could not", "shouldn't": "should not",
    "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not",
    "haven't": "have not", "hasn't": "has not", "hadn't": "had not"
  };

  /* 글을 채점용 낱말로 바꾼다.
     words 는 화면에 보여 줄 원래 낱말, toks 는 비교용, owner 는 toks 가 어느 낱말에서 나왔는지. */
  function tokenize(text, strict) {
    var src = (text || "").replace(/\u2019/g, "'").trim();
    var words = src.length ? src.split(/\s+/) : [];
    var toks = [], owner = [];
    for (var i = 0; i < words.length; i++) {
      var piece = words[i];
      if (strict) {
        toks.push(piece);
        owner.push(i);
        continue;
      }
      var w = piece.toLowerCase().replace(/-/g, " ");
      var parts = w.split(/\s+/);
      for (var p = 0; p < parts.length; p++) {
        var one = parts[p].replace(/^[^a-z0-9']+/, "").replace(/[^a-z0-9']+$/, "");
        if (!one) continue;
        if (EXPAND[one]) {
          var ex = EXPAND[one].split(" ");
          for (var e = 0; e < ex.length; e++) { toks.push(ex[e]); owner.push(i); }
        } else {
          toks.push(one.replace(/'/g, ""));
          owner.push(i);
        }
      }
    }
    return { words: words, toks: toks, owner: owner };
  }

  /* 정답과 입력을 가장 길게 겹치도록 맞춰 본다.
     자리를 하나씩 비교하면 낱말 하나를 빠뜨렸을 때 뒤가 전부 틀린 것이 된다. */
  function align(a, b) {
    var n = a.length, m = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) {
      dp.push([]);
      for (j = 0; j <= m; j++) dp[i].push(0);
    }
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = (a[i] === b[j]) ? dp[i + 1][j + 1] + 1
                                   : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var hit = [], extra = [];
    for (i = 0; i < n; i++) hit.push(false);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { hit[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
      else { extra.push(b[j]); j++; }
    }
    while (j < m) { extra.push(b[j]); j++; }
    return { hit: hit, extra: extra };
  }

  /* 낱말 단위로 맞았는지 돌려준다. 한 낱말이 여러 조각이 되면 전부 맞아야 맞은 것. */
  function grade(answer, typed, strict) {
    var A = tokenize(answer, strict);
    var B = tokenize(typed, strict);
    var r = align(A.toks, B.toks);
    var ok = [];
    for (var w = 0; w < A.words.length; w++) ok.push(null);
    for (var t = 0; t < A.toks.length; t++) {
      var o = A.owner[t];
      if (ok[o] === null) ok[o] = r.hit[t];
      else ok[o] = ok[o] && r.hit[t];
    }
    var right = 0;
    for (w = 0; w < ok.length; w++) if (ok[w]) right++;
    return { words: A.words, ok: ok, right: right, total: A.words.length, extra: r.extra };
  }







  /* ---------------------------------------------------------------- 편집 화면 (SPEC 8) */

  var editVideo = null;
  var editOrig = null;

  function showEdit(pid, videoId) {
    setProfileId(pid);
    show('edit');
    $('edit-back').onclick = function () { go('#/' + pid); };
    $('edit-save').onclick = saveEdited;
    $('paste-caps-btn').onclick = usePasted;
    $('edit-reset').onclick = function () {
      if (!editOrig) return;
      editVideo = JSON.parse(JSON.stringify(editOrig));
      drawEdit();
    };
    var box = $('edit-list');
    notice(box, 'Loading\u2026');

    getJSON('data/videos/' + pid + '/' + videoId + '.json', function (data) {
      editVideo = data;
      editOrig = JSON.parse(JSON.stringify(data));
      $('edit-title').textContent = data.title || videoId;
      drawEdit();
    }, function () {
      notice(box, 'Could not open that video.', true);
    });
  }

  function drawEdit() {
    var box = $('edit-list');
    clear(box);
    var list = editVideo.sentences || [];
    $('edit-count').textContent = list.length + ' sentences';

    var ul = el('ul', 'list');
    for (var i = 0; i < list.length; i++) {
      (function (s, idx) {
        var li = document.createElement('li');
        var card = el('div', 'editrow');
        card.appendChild(el('div', 'meta', (idx + 1) + ' \u00b7 ' + s.start.toFixed(1) + 's \u2013 ' + s.end.toFixed(1) + 's'));

        // 낱말마다 그 앞에서 자를 수 있게
        var line = el('div', 'words');
        var words = s.text.split(/\s+/);
        for (var w = 0; w < words.length; w++) {
          (function (at) {
            if (at > 0) {
              var cut = el('button', 'cut', '\u2702');
              cut.title = 'Split here';
              cut.onclick = function () { splitAt(idx, at); };
              line.appendChild(cut);
            }
            line.appendChild(el('span', 'word', words[at]));
          })(w);
        }
        card.appendChild(line);

        if (idx < list.length - 1) {
          var join = el('button', 'small', 'Join with next');
          join.onclick = function () { joinAt(idx); };
          card.appendChild(join);
        }
        li.appendChild(card);
        ul.appendChild(li);
      })(list[i], i);
    }
    box.appendChild(ul);
  }

  /* 다음 문장과 합친다. 시간은 앞 문장의 시작과 뒤 문장의 끝 (SPEC 8). */
  function joinAt(i) {
    var list = editVideo.sentences;
    if (i >= list.length - 1) return;
    var a = list[i], b = list[i + 1];
    a.text = (a.text + ' ' + b.text).replace(/\s+/g, ' ').trim();
    a.end = b.end;
    if (b.ko) a.ko = (a.ko ? a.ko + ' ' : '') + b.ko;
    list.splice(i + 1, 1);
    renumber();
    drawEdit();
  }

  /* 낱말 at 앞에서 자른다. 시간은 글자 길이에 비례해 나눈다 — 더 나은 근거가 없다. */
  function splitAt(i, at) {
    var list = editVideo.sentences;
    var s = list[i];
    var words = s.text.split(/\s+/);
    if (at <= 0 || at >= words.length) return;

    var left = words.slice(0, at).join(' ');
    var right = words.slice(at).join(' ');
    var span = s.end - s.start;
    var cut = s.start + span * (left.length / (left.length + right.length));
    cut = Math.round(cut * 100) / 100;

    var second = { i: 0, start: cut, end: s.end, text: right, recording: null };
    if (s.ko) second.ko = s.ko;
    s.text = left;
    s.end = cut;
    list.splice(i + 1, 0, second);
    renumber();
    drawEdit();
  }

  function renumber() {
    var list = editVideo.sentences;
    for (var i = 0; i < list.length; i++) list[i].i = i;
  }

  /* 붙여넣은 자막으로 문장을 갈아 끼운다 — 등록 스크립트가 실패할 때의 우회로 (SPEC 8).
     SRT 와 VTT 는 시각 줄 모양이 같다. 쉼표든 마침표든 받는다. */
  var CUE_LINE = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*--&gt;\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

  function parsePasted(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = line.replace(/&gt;/g, '>').match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
      if (m) {
        if (cur && cur.text) out.push(cur);
        cur = { start: toSeconds(m[1]), end: toSeconds(m[2]), text: '' };
        continue;
      }
      if (!cur) continue;
      var t = line.replace(/<[^>]*>/g, '').trim();
      if (!t) {
        if (cur.text) { out.push(cur); cur = null; }
        continue;
      }
      if (/^\d+$/.test(t) && !cur.text) continue;      // SRT 의 번호 줄
      cur.text = (cur.text ? cur.text + ' ' : '') + t;
    }
    if (cur && cur.text) out.push(cur);

    var rows = [];
    for (var j = 0; j < out.length; j++) {
      var s = out[j];
      var text = s.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (rows.length && rows[rows.length - 1].text === text) continue;   // 같은 줄이 이어지면 한 번만
      rows.push({ i: rows.length, start: Math.round(s.start * 100) / 100,
                  end: Math.round(s.end * 100) / 100, text: text, recording: null });
    }
    return rows;
  }

  function toSeconds(str) {
    var parts = String(str).replace(',', '.').split(':');
    var sec = 0;
    for (var i = 0; i < parts.length; i++) sec = sec * 60 + parseFloat(parts[i]);
    return sec || 0;
  }

  function usePasted() {
    var note = $('paste-caps-note');
    var rows = parsePasted($('paste-caps').value);
    if (!rows.length) {
      note.textContent = 'No timed lines found in that text.';
      return;
    }
    editVideo.sentences = rows;
    editVideo.source = 'manual_captions';
    drawEdit();
    note.textContent = 'Replaced with ' + rows.length + ' sentences. Save the file when it looks right.';
  }

  function saveEdited() {
    var text = JSON.stringify(editVideo, null, 2) + '\n';
    var name = editVideo.videoId + '.json';
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      $('edit-count').textContent = 'Saved ' + name + '. Hand it to Claude Code to put back.';
    } catch (e) {
      $('edit-count').textContent = 'This browser would not save the file.';
    }
  }

  /* ---------------------------------------------------------------- 백업 (SPEC 10) */

  function setupBackup() {
    $('export-btn').onclick = function () { withBackup(saveFile); };
    $('copy-btn').onclick = function () { withBackup(copyText); };
    $('import-btn').onclick = function () { $('import-file').click(); };
    $('import-file').onchange = readFile;
    $('paste-btn').onclick = pasteText;
  }

  function withBackup(then) {
    if (!window.Store || !Store.available()) { say2('Nothing is saved in this browser.'); return; }
    Store.exportAll(profileId, then, function () { say2('Could not read your records.'); });
  }

  function say2(msg) {
    var n = $('report-body');
    if (n) {
      var line = $('backup-say') || el('div', 'count');
      line.id = 'backup-say';
      line.textContent = msg;
      $('export-btn').parentNode.parentNode.appendChild(line);
    }
  }

  function fileName() {
    return 'dictation-' + (profileId || 'me') + '-' + Store.today() + '.json';
  }

  function saveFile(data) {
    var text = JSON.stringify(data);
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = fileName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      say2('Saved ' + fileName() + '.');
    } catch (e) {
      say2('This browser would not save a file. Use Copy to clipboard instead.');
    }
  }

  /* 파일 저장이 막히는 기기가 있어 클립보드 길도 둔다 (SPEC 10) */
  function copyText(data) {
    var text = JSON.stringify(data);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        say2('Copied. Paste it somewhere safe.');
      }, function () { showForCopy(text); });
    } else {
      showForCopy(text);
    }
  }

  function showForCopy(text) {
    var box = $('paste-box');
    box.style.display = 'block';
    box.value = text;
    box.focus();
    box.select();
    say2('Could not copy on its own. Select the text above and copy it.');
  }

  function readFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () { applyBackup(fr.result); };
    fr.onerror = function () { say2('Could not read that file.'); };
    fr.readAsText(f);
  }

  function pasteText() {
    var box = $('paste-box');
    if (box.style.display === 'none' || !box.value.replace(/\s/g, '')) {
      box.style.display = 'block';
      box.value = '';
      box.focus();
      say2('Paste the copied text above, then press Paste a copy again.');
      return;
    }
    applyBackup(box.value);
  }

  function applyBackup(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { say2('That does not look like a saved copy.'); return; }
    if (!data || data.app !== 'dictation') { say2('That does not look like a saved copy.'); return; }

    Store.importAll(profileId, data, function () {
      say2('Loaded. Reopening the report\u2026');
      setTimeout(function () { showReport(profileId); }, 400);
    }, function () { say2('Could not load that copy.'); });
  }

  /* ---------------------------------------------------------------- 문장카드 복습 (SPEC 7) */

  var MODES = [
    { id: 'ko', name: 'Korean → English', hint: 'Read the Korean, say it in English.' },
    { id: 'listen', name: 'Listen and say', hint: 'Hear it, say it back. Text stays hidden.' },
    { id: 'blank', name: 'Fill the blanks', hint: 'The words you missed are hidden.' },
    { id: 'retype', name: 'Type it again', hint: 'Write the whole sentence again.' }
  ];
  var cardMode = 'retype';
  var cardList = [];        // [{card, sentence, videoTitle}]
  var cardAt = 0;
  var cardShown = false;

  function showCards(pid, mode) {
    setProfileId(pid);
    show('cards');
    if (mode) cardMode = mode;
    var box = $('cards-body');
    notice(box, 'Loading\u2026');

    if (!window.Store || !Store.available()) {
      notice(box, 'This browser will not let the app save cards.', true);
      return;
    }
    Store.listCards(pid, function (cards) {
      if (!cards.length) {
        clear(box);
        box.appendChild(modeRow(pid));
        notice2(box, 'No cards yet.\nWhile practising, press Save card on any sentence '
          + 'you want to come back to.');
        return;
      }
      // 빈칸 모드는 그 문장에서 틀렸던 낱말을 알아야 한다
      Store.listMisses(pid, function (misses) {
        loadCardSentences(pid, cards, function (rows) {
          attachMisses(rows, misses);
          cardList = filterForMode(rows, cardMode);
          cardAt = 0;
          drawCards(box, pid);
        });
      }, function () {
        loadCardSentences(pid, cards, function (rows) {
          cardList = filterForMode(rows, cardMode);
          cardAt = 0;
          drawCards(box, pid);
        });
      });
    }, function () { notice(box, 'Could not read your cards.', true); });
  }

  function notice2(box, text) {
    var n = el('div', 'notice', text);
    box.appendChild(n);
  }

  /* 카드가 가리키는 문장을 영상 파일에서 찾아온다. 영상 하나당 한 번만 읽는다. */
  function loadCardSentences(pid, cards, done) {
    var need = {}, ids = [];
    for (var i = 0; i < cards.length; i++) {
      if (!need[cards[i].videoId]) { need[cards[i].videoId] = true; ids.push(cards[i].videoId); }
    }
    var videos = {};
    var left = ids.length;
    if (!left) { done([]); return; }

    for (var v = 0; v < ids.length; v++) {
      (function (vid) {
        getJSON('data/videos/' + pid + '/' + vid + '.json', function (data) {
          videos[vid] = data; step();
        }, function () { videos[vid] = null; step(); });
      })(ids[v]);
    }

    function step() {
      left--;
      if (left > 0) return;
      var rows = [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var d = videos[c.videoId];
        if (!d || !d.sentences || !d.sentences[c.i]) continue;
        rows.push({ card: c, s: d.sentences[c.i], title: d.title || c.videoId });
      }
      rows.sort(function (a, b) { return (a.card.date < b.card.date) ? 1 : -1; });
      done(rows);
    }
  }

  function attachMisses(rows, misses) {
    var by = {};
    for (var i = 0; i < misses.length; i++) {
      var m = misses[i];
      var k = m.videoId + '|' + m.i;
      if (!by[k]) by[k] = {};
      by[k][String(m.word).toLowerCase().replace(/[^a-z0-9']/g, '')] = true;
    }
    for (var r = 0; r < rows.length; r++) {
      rows[r].missed = by[rows[r].card.videoId + '|' + rows[r].card.i] || {};
    }
  }

  /* 한→영 모드는 한국어가 있는 문장만 쓸 수 있다 */
  function filterForMode(rows, mode) {
    if (mode !== 'ko') return rows;
    var out = [];
    for (var i = 0; i < rows.length; i++) if (rows[i].s.ko) out.push(rows[i]);
    return out;
  }

  function modeRow(pid) {
    var wrap = el('div', 'modes');
    for (var i = 0; i < MODES.length; i++) {
      (function (m) {
        var b = el('button', 'small' + (m.id === cardMode ? ' on' : ''), m.name);
        b.onclick = function () { go('#/' + pid + '/cards/' + m.id); };
        wrap.appendChild(b);
      })(MODES[i]);
    }
    return wrap;
  }

  function drawCards(box, pid) {
    clear(box);
    box.appendChild(modeRow(pid));

    if (!cardList.length) {
      notice2(box, cardMode === 'ko'
        ? 'No cards with a Korean translation yet. Videos need Korean captions for this mode.'
        : 'No cards yet.');
      return;
    }
    cardShown = false;

    var row = cardList[cardAt];
    var head = el('div', 'count', (cardAt + 1) + ' of ' + cardList.length + ' \u00b7 ' + row.title);
    box.appendChild(head);

    var m = modeById(cardMode);
    box.appendChild(el('div', 'hint', m.hint));

    var face = el('div', 'now', '');
    face.id = 'card-face';
    box.appendChild(face);
    drawCardFace(row);

    var btns = el('div', 'buttons');
    if (cardMode === 'listen' || cardMode === 'blank' || cardMode === 'retype') {
      var play = el('button', 'half', 'Play');
      play.onclick = function () { playCardAudio(row); };
      btns.appendChild(play);
    }
    var showBtn = el('button', 'half', 'Show');
    showBtn.onclick = function () { cardShown = true; drawCardFace(row); };
    btns.appendChild(showBtn);
    box.appendChild(btns);

    if (cardMode === 'retype' || cardMode === 'blank') {
      var ta = document.createElement('textarea');
      ta.id = 'card-input';
      ta.rows = 3;
      ta.placeholder = 'Type it';
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('spellcheck', 'false');
      box.appendChild(ta);
      var check = el('div', 'buttons');
      var cb = el('button', 'primary', 'Check');
      cb.onclick = function () { checkCard(row); };
      check.appendChild(cb);
      box.appendChild(check);
    }

    var nav = el('div', 'buttons');
    var prev = el('button', 'half', '\u2039 Previous');
    prev.disabled = (cardAt === 0);
    prev.onclick = function () { cardAt--; drawCards(box, pid); };
    var next = el('button', 'half', 'Next \u203a');
    next.disabled = (cardAt >= cardList.length - 1);
    next.onclick = function () { cardAt++; drawCards(box, pid); };
    nav.appendChild(prev);
    nav.appendChild(next);
    box.appendChild(nav);

    var open = el('div', 'buttons');
    var ob = el('button', 'half', 'Open in the video');
    ob.onclick = function () { go('#/' + pid + '/' + row.card.videoId + '/' + row.card.i); };
    open.appendChild(ob);
    var rm = el('button', 'half', 'Remove card');
    rm.onclick = function () { removeCurrentCard(pid, row); };
    open.appendChild(rm);
    box.appendChild(open);
  }

  function removeCurrentCard(pid, row) {
    Store.removeCard(pid, row.card.videoId, row.card.i, function () {
      cardList.splice(cardAt, 1);
      if (cardAt >= cardList.length) cardAt = Math.max(0, cardList.length - 1);
      drawCards($('cards-body'), pid);
    }, function () { say('Could not remove that card.'); });
  }

  function modeById(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return MODES[3];
  }

  function drawCardFace(row) {
    var face = $('card-face');
    if (!face) return;
    clear(face);
    face.className = 'now';

    if (cardShown) {
      face.appendChild(document.createTextNode(row.s.text));
      if (row.s.ko) face.appendChild(el('span', 'ko', row.s.ko));
      return;
    }
    if (cardMode === 'ko') {
      face.appendChild(document.createTextNode(row.s.ko || ''));
      return;
    }
    if (cardMode === 'blank') {
      face.appendChild(blanked(row));
      return;
    }
    face.className = 'now empty';
    face.appendChild(document.createTextNode(
      cardMode === 'listen' ? 'Press Play, then say it back.' : 'Press Play, then type it.'));
  }

  /* 빈칸 채우기 — 그 문장에서 틀렸던 낱말만 가린다 (SPEC 7) */
  function blanked(row) {
    var wrap = el('span', null);
    var words = row.s.text.split(/\s+/);
    var missed = row.missed || {};
    for (var i = 0; i < words.length; i++) {
      var bare = words[i].toLowerCase().replace(/[^a-z0-9']/g, '');
      if (missed[bare]) {
        wrap.appendChild(el('span', 'blank', words[i].replace(/[A-Za-z0-9]/g, '_')));
      } else {
        wrap.appendChild(document.createTextNode(words[i]));
      }
      wrap.appendChild(document.createTextNode(' '));
    }
    return wrap;
  }

  function playCardAudio(row) {
    go('#/' + profileId + '/' + row.card.videoId + '/' + row.card.i);
  }

  function checkCard(row) {
    var ta = $('card-input');
    if (!ta || !ta.value.replace(/\s/g, '')) return;
    var r = grade(row.s.text, ta.value, strict);
    cardShown = true;
    var face = $('card-face');
    clear(face);
    face.className = 'now';
    for (var i = 0; i < r.words.length; i++) {
      face.appendChild(el('span', r.ok[i] ? 'w' : 'w bad', r.words[i]));
      face.appendChild(document.createTextNode(' '));
    }
    face.appendChild(el('span', 'ko', r.right + ' of ' + r.total + ' words correct.'));
  }

  /* ---------------------------------------------------------------- 오답 리포트 (SPEC 10) */

  function showReport(pid) {
    setProfileId(pid);
    show('report');
    var box = $('report-body');
    notice(box, 'Loading\u2026');

    if (!window.Store || !Store.available()) {
      notice(box, 'This browser will not let the app save progress,\nso there is nothing to report yet.', true);
      return;
    }
    Store.listMisses(pid, function (misses) {
      Store.listDays(pid, function (days) {
        drawReport(box, pid, misses, days);
      }, function () { drawReport(box, pid, misses, []); });
    }, function () {
      notice(box, 'Could not read your records.', true);
    });
  }

  function drawReport(box, pid, misses, days) {
    clear(box);

    box.appendChild(streakBlock(days));
    box.appendChild(daysBlock(days));

    var head = el('div', 'count', 'Words you miss most');
    box.appendChild(head);

    if (!misses.length) {
      var n = el('div', 'notice', 'Nothing yet. Check a few sentences and the words you miss show up here.');
      box.appendChild(n);
      return;
    }

    // 낱말별로 모으고, 가장 최근에 틀린 자리를 기억해 둔다
    var byWord = {};
    for (var i = 0; i < misses.length; i++) {
      var m = misses[i];
      var w = m.word;
      if (!byWord[w]) byWord[w] = { word: w, n: 0, videoId: m.videoId, i: m.i, date: m.date };
      byWord[w].n++;
      if (m.date >= byWord[w].date) { byWord[w].date = m.date; byWord[w].videoId = m.videoId; byWord[w].i = m.i; }
    }
    var rows = [];
    for (var k in byWord) { if (byWord.hasOwnProperty(k)) rows.push(byWord[k]); }
    rows.sort(function (a, b) { return (b.n - a.n) || (a.word < b.word ? -1 : 1); });

    head.textContent = 'Words you miss most \u00b7 ' + rows.length + ' words, '
      + misses.length + ' misses';

    // 목록이 길어지면 위쪽만 보여 준다. 자주 틀리는 것을 보자는 화면이라 꼬리는 도움이 안 된다.
    var LIMIT = 50;
    var shown = rows.slice(0, LIMIT);

    var ul = el('ul', 'list');
    for (var r = 0; r < shown.length; r++) {
      (function (row) {
        var b = el('button', 'item');
        var body = el('div', 'body');
        body.appendChild(el('div', 'name', row.word));
        body.appendChild(el('div', 'meta', 'missed ' + row.n + (row.n === 1 ? ' time' : ' times') + ' \u00b7 last ' + row.date));
        b.appendChild(body);
        b.appendChild(el('div', 'tally', String(row.n)));
        b.onclick = function () { go('#/' + pid + '/' + row.videoId + '/' + row.i); };
        var li = document.createElement('li');
        li.appendChild(b);
        ul.appendChild(li);
      })(shown[r]);
    }
    box.appendChild(ul);
    if (rows.length > LIMIT) {
      box.appendChild(el('div', 'count', 'Showing the top ' + LIMIT + '.'));
    }
  }

  /* 연속 학습 일수 — 오늘(또는 어제)부터 거꾸로 이어지는 날 수 */
  function streakBlock(days) {
    var have = {};
    for (var i = 0; i < days.length; i++) if (days[i].count > 0) have[days[i].date] = true;

    var n = 0;
    var d = new Date();
    if (!have[dateStr(d)]) d.setDate(d.getDate() - 1);   // 오늘 아직 안 했어도 어제까지는 인정
    while (have[dateStr(d)]) { n++; d.setDate(d.getDate() - 1); }

    var box = el('div', 'notice');
    var big = el('b', null, n === 0 ? 'No streak yet' : (n + (n === 1 ? ' day' : ' days') + ' in a row'));
    box.appendChild(big);
    return box;
  }

  /* 최근 14일 학습량 */
  function daysBlock(days) {
    var byDate = {};
    for (var i = 0; i < days.length; i++) byDate[days[i].date] = days[i].count;

    var max = 1;
    for (var k in byDate) if (byDate.hasOwnProperty(k) && byDate[k] > max) max = byDate[k];

    var wrap = el('div', 'chart');
    var d = new Date();
    d.setDate(d.getDate() - 13);
    for (var j = 0; j < 14; j++) {
      var key = dateStr(d);
      var c = byDate[key] || 0;
      var col = el('div', 'bar' + (c ? '' : ' zero'));
      col.title = key + ': ' + c;
      var fill = el('div', 'fill');
      fill.style.height = Math.round((c / max) * 100) + '%';
      col.appendChild(fill);
      wrap.appendChild(col);
      d.setDate(d.getDate() + 1);
    }
    var box = el('div', 'notice');
    box.appendChild(el('div', 'chartlabel', 'Sentences checked, last 14 days'));
    box.appendChild(wrap);
    return box;
  }

  function dateStr(d) {
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /* ---------------------------------------------------------------- 진도 (SPEC 4-2) */

  function setProfileId(id) { profileId = id; }

  function loadProgress(profileId, videoId, done) {
    progress = null;
    if (!window.Store || !Store.available()) {
      noteStorage();
      done(0);
      return;
    }
    Store.getProgress(profileId, videoId, function (row) {
      progress = row;
      var at = row.at || 0;
      var list = (video && video.sentences) || [];
      if (at >= list.length) at = 0;
      markDone();
      done(at);
    }, function () { noteStorage(); done(0); });
  }

  function noteStorage() {
    var n = $('storage-note');
    if (n) n.style.display = 'block';
  }

  /* 채점 결과를 남긴다. 오답 낱말과 문장카드도 여기서 적재한다 — SPEC 6번 3단계. */
  function recordResult(r) {
    if (!progress || !profileId || !video) return;
    var correct = (r.right === r.total);
    progress.at = current;
    progress.sentences[current] = correct ? 'ok' : 'miss';
    Store.saveProgress(progress, noteStorage);
    Store.bumpDay(profileId, noteStorage);

    if (!correct) {
      var missed = [];
      for (var i = 0; i < r.words.length; i++) {
        if (!r.ok[i]) {
          var w = r.words[i].replace(/^[^A-Za-z0-9']+/, '').replace(/[^A-Za-z0-9']+$/, '');
          if (w) missed.push(w);
        }
      }
      // 틀렸다고 카드에 자동으로 담지는 않는다. 담을 문장은 사람이 고른다 (SPEC 7).
      // 틀린 낱말 기록은 그대로 남긴다 — 오답 리포트의 재료다.
      Store.addMisses(profileId, video.videoId, current, missed, noteStorage);
    }
    markDone();
  }

  /* 어디까지 했는지 문장 목록과 위치 표시에 남긴다 */
  function markDone() {
    if (!progress) return;
    var list = (video && video.sentences) || [];
    var done = 0;
    for (var k in progress.sentences) {
      if (progress.sentences.hasOwnProperty(k)) done++;
    }
    var el2 = $('done-count');
    if (el2) {
      el2.textContent = list.length ? (done + ' of ' + list.length + ' practised') : '';
    }
    for (var i = 0; i < list.length; i++) {
      var b = $('sentence-' + i);
      if (!b) continue;
      var mark = progress.sentences[i];
      b.setAttribute('data-done', mark || '');
    }
  }

  /* ---------------------------------------------------------------- 받아쓰기 */

  function sentenceAt(idx) {
    var list = (video && video.sentences) || [];
    return (idx >= 0 && idx < list.length) ? list[idx] : null;
  }

  function resetAnswer() {
    resetSpeak();
    var sc = $('save-card-btn');
    if (sc) { sc.className = 'half'; sc.textContent = 'Save card'; }
    checked = false;
    hintAt = 0;
    $('answer-input').value = '';
    $('answer-input').disabled = false;
    $('hint-line').textContent = '';
    clear($('now'));
    $('now').className = 'now empty';
    $('now').appendChild(document.createTextNode('Listen, then type what you hear.'));
    $('check-btn').disabled = false;
  }

  function checkAnswer() {
    var s = sentenceAt(current);
    if (!s) return;
    var typed = $('answer-input').value;
    if (!typed.replace(/\s/g, '')) {
      say('Type something first, or press Show answer.');
      return;
    }
    var r = grade(s.text, typed, strict);
    showGraded(r, s);
    checked = true;
    recordResult(r);
    say(r.right + ' of ' + r.total + ' words correct.');
  }

  function showGraded(r, s) {
    var box = $('now');
    clear(box);
    box.className = 'now';
    for (var i = 0; i < r.words.length; i++) {
      var w = el('span', r.ok[i] ? 'w' : 'w bad', r.words[i]);
      box.appendChild(w);
      box.appendChild(document.createTextNode(' '));
    }
    if (r.extra.length) {
      var ex = el('div', 'extra', 'Not in the sentence: ' + r.extra.join(', '));
      box.appendChild(ex);
    }
    if (s && s.ko) box.appendChild(el('span', 'ko', s.ko));
  }

  function revealAnswer() {
    var s = sentenceAt(current);
    if (!s) return;
    var box = $('now');
    clear(box);
    box.className = 'now';
    box.appendChild(document.createTextNode(s.text));
    if (s.ko) box.appendChild(el('span', 'ko', s.ko));
    checked = true;
    hintAt = 3;
    say('Answer shown. Try the next sentence.');
  }

  /* SPEC 6 힌트 단계: 느리게 듣기 → 첫 글자 → 절반 → 정답 */
  function nextHint() {
    var s = sentenceAt(current);
    if (!s) return;
    hintAt++;
    if (hintAt === 1) {
      $('hint-line').textContent = masked(s.text, 1);
      say('Hint: first letter of each word.');
    } else if (hintAt === 2) {
      $('hint-line').textContent = masked(s.text, 0.5);
      say('Hint: about half of each word.');
    } else {
      $('hint-line').textContent = '';
      revealAnswer();
    }
  }

  /* 낱말마다 앞에서 몇 글자만 보여 준다.
     keep 이 1 이면 첫 글자 하나, 0.5 면 길이의 절반쯤. */
  function masked(text, keep) {
    var words = text.split(/\s+/);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var letters = w.replace(/[^a-zA-Z0-9]/g, '').length;
      var show = (keep >= 1) ? 1 : Math.max(1, Math.ceil(letters * keep));
      var seen = 0, shown = '';
      for (var j = 0; j < w.length; j++) {
        var ch = w.charAt(j);
        if (/[a-zA-Z0-9]/.test(ch)) {
          seen++;
          shown += (seen <= show) ? ch : '\u2013';
        } else {
          shown += ch;
        }
      }
      out.push(shown);
    }
    return out.join(' ');
  }

  /* 손으로 카드에 담기 — SPEC 7 의 "수동 저장".
     틀린 문장은 자동으로 담기지만, 맞혔어도 더 보고 싶은 문장이 있다. */
  function saveCard() {
    if (!video || current < 0) {
      say('Pick a sentence first.');
      return;
    }
    if (!window.Store || !Store.available()) {
      say('This browser will not let the app save cards.');
      return;
    }
    var vid = video.videoId, at = current;
    Store.addCard(profileId, vid, at, 'manual', function () {
      say('Could not save the card.');
    });
    // 정말 들어갔는지 확인하고 말한다. 넣기만 하고 끝내면 실패를 모른다.
    setTimeout(function () {
      Store.listCards(profileId, function (list) {
        var key = profileId + '|' + vid + '|' + at;
        var found = false;
        for (var i = 0; i < list.length; i++) if (list[i].key === key) found = true;
        if (!found) { say('Could not save the card.'); return; }
        var b = $('save-card-btn');
        b.className = 'half on';
        b.textContent = 'Saved';
        say('Saved to cards \u2014 ' + list.length + ' saved. Open Cards from the library.');
      }, function () { say('Saved, but could not read the card list back.'); });
    }, 150);
  }

  function toggleStrict() {
    strict = !strict;
    $('strict-btn').className = strict ? 'small on' : 'small';
    $('strict-btn').textContent = strict ? 'Strict' : 'Lenient';
    say(strict
      ? 'Strict: capitals and punctuation must match.'
      : 'Lenient: capitals, punctuation and contractions are forgiven.');
    if (checked) checkAnswer();
  }


  /* ---------------------------------------------------------------- 따라 말하기 (SPEC 6의 4·5) */

  /* 기기가 못 하면 오류 화면 대신 그 자리를 감춘다 — SPEC 9 */
  function setupSpeak() {
    if (!window.Recorder || !Recorder.canRecord()) {
      $('speak').style.display = 'none';
      return;
    }
    $('rec-btn').onclick = toggleRecord;
    $('mine-btn').onclick = playMine;
  }

  function resetSpeak() {
    if (!window.Recorder || !Recorder.canRecord()) return;
    Recorder.discard();          // 문장이 넘어가면 녹음은 버린다 (SPEC 2)
    recording = false;
    $('rec-btn').className = 'half';
    $('rec-btn').textContent = 'Record';
    $('mine-btn').disabled = true;
    $('heard').textContent = '';
    var au = $('mine');
    if (au) { try { au.pause(); } catch (e) {} au.removeAttribute('src'); }
  }

  function toggleRecord() {
    if (recording) { stopRecord(); return; }
    Recorder.start(function () {
      recording = true;
      $('rec-btn').className = 'half rec-on';
      $('rec-btn').textContent = 'Stop';
      $('heard').textContent = '';
      say('Recording. Say the sentence, then press Stop.');
    }, function (why) {
      if (why === 'denied') say('Microphone permission was refused, so recording is off.');
      else if (why === 'unsupported') { $('speak').style.display = 'none'; }
      else say('Could not start recording.');
    });
  }

  function stopRecord() {
    recording = false;
    $('rec-btn').className = 'half';
    $('rec-btn').textContent = 'Record';
    Recorder.stop(function (url, heard) {
      if (url) {
        $('mine').src = url;
        $('mine-btn').disabled = false;
      }
      showHeard(heard);
      say(url ? 'Recorded. Play it back, or record again.' : 'Nothing was recorded.');
    });
  }

  function playMine() {
    var au = $('mine');
    if (!au || !au.getAttribute('src')) return;
    try { au.currentTime = 0; au.play(); } catch (e) { say('Could not play the recording.'); }
  }

  /* 음성인식이 되는 기기에서는 받아적은 것을 정답과 견줘 보여 준다 */
  function showHeard(heard) {
    var box = $('heard');
    clear(box);
    if (!Recorder.canTranscribe()) return;
    if (!heard) {
      box.appendChild(document.createTextNode('Did not catch that.'));
      return;
    }
    var s = sentenceAt(current);
    if (!s) { box.appendChild(document.createTextNode(heard)); return; }
    var r = grade(s.text, heard, false);
    box.appendChild(document.createTextNode('Heard: '));
    var typed = heard.split(/\s+/);
    var ok = grade(heard, s.text, false).ok;
    for (var i = 0; i < typed.length; i++) {
      box.appendChild(el('span', ok[i] ? 'w' : 'w bad', typed[i]));
      box.appendChild(document.createTextNode(' '));
    }
    box.appendChild(el('span', null, ' (' + r.right + '/' + r.total + ')'));
  }

  /* ---------------------------------------------------------------- 재생 */

  function stopWatch() {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  }

  function startWatch(end) {
    stopWatch();
    targetEnd = end;
    var armed = false;
    var waited = 0;
    watchTimer = setInterval(function () {
      if (!player || typeof player.getCurrentTime !== 'function') return;
      var t = player.getCurrentTime();

      // 자리를 옮기라고 했어도 반영되기까지 시간이 걸린다. 그 사이 재생 위치는
      // 아직 앞 문장 끝에 머물러 있어서, 바로 끝 판정을 하면 누르자마자 멈춘다.
      // 실제로 구간 안으로 들어온 것을 본 뒤에 감시를 시작한다.
      if (!armed) {
        waited += TICK_MS;
        if (t < targetEnd - STOP_MARGIN || waited > 3000) armed = true;
        return;
      }

      if (t >= targetEnd - STOP_MARGIN) {
        stopWatch();
        player.pauseVideo();
        say('Done. Replay it, or go to the next sentence.');
      }
    }, TICK_MS);
  }

  var loadTimer = null;

  function watchPlayerLoad() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (!playerReady) {
        say("Couldn't load the player. Check your connection and reload.");
      }
    }, 8000);
  }

  function loadedVideoId() {
    try { return (player.getVideoData() || {}).video_id || ''; } catch (e) { return ''; }
  }

  /* 유튜브 자막이 켜져 있으면 답이 화면에 그대로 보인다.
     playerVars 만으로는 확실히 꺼지지 않아서 모듈을 내린다.

     setOption('captions', ...) 은 부르면 안 된다. 그 함수는 모듈을 먼저 올려야 동작하므로,
     방금 내린 자막을 도로 올려서 브라우저 언어(한국어) 자막이 붙는다. 실제로 겪었다. */
  function killCaptions() {
    if (!player) return;
    try { player.unloadModule('captions'); } catch (e) {}
    try { player.unloadModule('cc'); } catch (e) {}
  }

  /* 재생이 시작된 직후에 유튜브가 자막을 다시 올리기도 한다. 몇 번 더 내린다. */
  function killCaptionsSoon() {
    killCaptions();
    setTimeout(killCaptions, 400);
    setTimeout(killCaptions, 1200);
  }

  function ensurePlayer(videoId) {
    watchPlayerLoad();
    if (!apiReady) { wantPlay = videoId; return; }

    if (player) {
      // 재생기는 한 번만 만든다. 영상이 다르면 갈아 끼운다 —
      // 안 그러면 다른 영상을 골라도 앞 영상이 그대로 남는다.
      if (loadedVideoId() !== videoId) {
        stopWatch();
        setCover(true);
        try { player.cueVideoById(videoId); } catch (e) {}
        killCaptionsSoon();
      }
      return;
    }

    if (!player) {
      player = new YT.Player('player', {
        width: '100%',
        height: '100%',
        videoId: videoId,
        playerVars: {
          playsinline: 1,     // 아이폰에서 전체화면으로 튀지 않게
          rel: 0,
          modestbranding: 1,
          controls: 0,        // 재생 눈금과 시간 표시를 감춘다. 조작은 아래 버튼으로 한다
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          cc_load_policy: 0   // 자막이 보이면 받아쓰기가 아니라 베껴쓰기가 된다
        },
        events: {
          onReady: function () {
            playerReady = true;
            killCaptionsSoon();
            if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
            setControls(true);
            say('Ready. Tap a sentence.');
          },
          onStateChange: function (e) {
            if (e.data === YT.PlayerState.PLAYING) {
              setCover(false);
              killCaptionsSoon();
            } else if (e.data === YT.PlayerState.ENDED) {
              stopWatch();
              setCover(true);
            } else if (e.data === YT.PlayerState.PAUSED) {
              // 자리를 옮기는 순간에도 잠깐 멈춤으로 잡힌다. 그건 사용자가 멈춘 게 아니다.
              if ((new Date()).getTime() - startedAt > 800) {
                stopWatch();
                setCover(true);
              }
            }
          },
          onError: function () {
            stopWatch();
            say("This video can't be played. It may have been removed, or the owner blocked embedding.");
          }
        }
      });
    }
  }

  function setCover(on) {
    var c = $('cover');
    if (!c) return;
    // 소리만 듣기가 켜져 있으면 가림막을 걷지 않는다
    c.className = (on || audioOnly) ? 'cover' : 'cover off';
  }

  function toggleAudioOnly() {
    audioOnly = !audioOnly;
    $('audio-btn').className = audioOnly ? 'small on' : 'small';
    $('audio-btn').textContent = audioOnly ? 'Audio only' : 'Video on';
    setCover(audioOnly ? true : !isPlaying());
    say(audioOnly
      ? 'Video hidden. Some videos burn a translation into the picture.'
      : 'Video shown.');
  }

  function isPlaying() {
    if (!player || typeof player.getPlayerState !== 'function') return false;
    try { return player.getPlayerState() === YT.PlayerState.PLAYING; } catch (e) { return false; }
  }

  function setControls(on) {
    $('play-btn').disabled = !on;
    $('replay-btn').disabled = !on;
    // 배속은 재생기가 없어도 미리 정해 둘 수 있다
  }

  function playCurrent() {
    var list = (video && video.sentences) || [];
    if (current < 0 || current >= list.length) return;
    if (!playerReady) { say('Still loading the video. Try again in a moment.'); return; }

    var s = list[current];
    var from = Math.max(0, s.start - lead);
    stopWatch();
    startedAt = (new Date()).getTime();

    // 순서가 중요하다. 모바일 사파리는 화면을 누른 그 흐름에서 재생을 시작해야 받아 준다.
    // 자리를 먼저 옮기면 재생 명령이 씹혀서 "위치만 가고 안 들리는" 상태가 된다.
    player.playVideo();
    player.seekTo(from, true);
    player.setPlaybackRate(slow ? 0.75 : 1);

    startWatch(s.end + TAIL);
    nudge(0);
    say('Playing sentence ' + (current + 1) + (slow ? ' at 0.75\u00d7' : ''));
  }

  function nudge(tries) {
    if (tries > 6) return;
    setTimeout(function () {
      if (!watchTimer || !player || typeof player.getPlayerState !== 'function') return;
      var st = player.getPlayerState();
      if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) {
        player.playVideo();
        nudge(tries + 1);
      }
    }, 250);
  }

  // lead-in: 자막이 가리키는 시각보다 얼마나 앞에서 재생을 시작할지 (자막·방송의 정식 용어)
  function setLead(value) {
    lead = Math.round(value * 10) / 10;
    $('lead-value').textContent = lead.toFixed(1) + 's';
  }

  function toggleSlow() {
    slow = !slow;
    var b = $('slow-btn');
    b.className = slow ? 'on' : '';
    b.textContent = slow ? '0.75\u00d7 on' : '0.75\u00d7 speed';
    if (playerReady) player.setPlaybackRate(slow ? 0.75 : 1);
  }


  /* SPEC 6 단축키. 글을 치는 중에도 눌리는 조합으로 골랐다. */
  function onKey(e) {
    var ev = e || window.event;
    var key = ev.key || '';
    if (key === 'Enter' && !ev.shiftKey && !ev.altKey) {
      if (ev.preventDefault) ev.preventDefault();
      if (checked) select(current + 1, true);
      else checkAnswer();
      return false;
    }
    if (key === 'Enter' && ev.shiftKey) {
      if (ev.preventDefault) ev.preventDefault();
      playCurrent();
      return false;
    }
    if (ev.altKey && (key === 'h' || key === 'H')) {
      if (ev.preventDefault) ev.preventDefault();
      nextHint();
      return false;
    }
    if (ev.altKey && (key === 's' || key === 'S')) {
      if (ev.preventDefault) ev.preventDefault();
      toggleSlow();
      playCurrent();
      return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- 시작 */

  window.onYouTubeIframeAPIReady = function () {
    apiReady = true;
    if (wantPlay) { var v = wantPlay; wantPlay = null; ensurePlayer(v); }
  };

  function boot() {
    setControls(false);
    $('play-btn').onclick = playCurrent;
    $('replay-btn').onclick = playCurrent;
    $('slow-btn').onclick = toggleSlow;
    $('prev-btn').onclick = function () { select(current - 1, true); };
    $('next-btn').onclick = function () { select(current + 1, true); };
    $('change-profile').onclick = function () { go('#/'); };
    $('report-btn').onclick = function () { go('#/' + profileId + '/report'); };
    $('report-back').onclick = function () { go('#/' + profileId); };
    $('cards-btn').onclick = function () { go('#/' + profileId + '/cards'); };
    $('cards-back').onclick = function () { go('#/' + profileId); };
    setupBackup();
    $('list-btn').onclick = function () { toggleList(); };
    $('cover').onclick = playCurrent;
    $('check-btn').onclick = checkAnswer;
    $('hint-btn').onclick = nextHint;
    $('reveal-btn').onclick = revealAnswer;
    $('save-card-btn').onclick = saveCard;
    $('strict-btn').onclick = toggleStrict;
    $('audio-btn').onclick = toggleAudioOnly;
    setupSpeak();
    $('answer-input').onkeydown = onKey;

    $('lead-range').onchange = function () { setLead(parseFloat(this.value)); };
    $('lead-range').oninput = function () { setLead(parseFloat(this.value)); };
    setLead(lead);

    if (window.addEventListener) window.addEventListener('hashchange', route, false);
    route();

    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})();
