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
  var playable = [];        // 연습에 쓸 문장의 자리 번호만 모은 것
  var posAt = {};           // 자리 번호 → 몇 번째 연습 문장인지
  var slow = false;
  var repeat = false;       // 켜 두면 그 문장만 계속 되풀이한다
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
  var loopFrom = null;      // 되풀이할 때 돌아갈 자리
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
    var all = ['profiles', 'library', 'listen', 'report', 'cards', 'edit', 'daily',
               'settings', 'talk'];
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
    // 화면을 옮기면 소리도 멈춘다. 되풀이를 켜 두면 안 그럴 때 계속 들린다
    if (player && playerReady) { try { player.pauseVideo(); } catch (e) {} }
    clipStopWatch();
    clipCover(true);
    if (clip && clipReady) { try { clip.pauseVideo(); } catch (e) {} }
    // 녹음은 화면을 옮기는 순간 버린다 (SPEC 2)
    if (dailyRecording && window.Recorder) { Recorder.discard(); dailyRecording = false; }
    if (window.TalkUI) TalkUI.leave();
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) {} }

    if (!profileId) { showProfiles(); return; }
    if (!videoId) { showLibrary(profileId); return; }
    if (videoId === 'report') { showReport(profileId); return; }
    if (videoId === 'settings') { showSettings(profileId); return; }
    if (videoId === 'talk') { openTalk(profileId); return; }
    if (videoId === 'daily' || videoId === 'shows') {
      dailyKind = (videoId === 'shows') ? 'shows' : 'made';
      showDaily(profileId, parts[2] || '', parts[3] ? parseInt(parts[3], 10) : null);
      return;
    }
    // 하루 문장은 영상이 아니다. 카드에서 넘어온 주소를 제자리로 보낸다
    if (isDailyId(videoId)) {
      go('#/' + profileId + '/' + routeOfKind(kindOfId(videoId)) + '/' + videoId.slice(6)
        + (parts[2] ? '/' + parts[2] : ''));
      return;
    }
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

  /* ------------------------------------------------ 연습에 못 쓰는 줄 (SPEC 8) */

  /* 자막을 문장으로 자르면 "Hi." "Yeah." "Me too." 같은 토막이 잔뜩 나온다.
     받아쓰기가 되지 않는데 목록의 네 개 중 하나를 차지해서 뒤 문장으로 가는 길만 막는다.
     낱말 두 개 이하이거나 감탄사뿐인 줄은 연습에서 뺀다 (운영자 결정).

     빼되 **자리 번호는 건드리지 않는다.** 문장카드와 진도가 자리 번호를 가리키고 있어서
     번호가 밀리면 예전에 담아 둔 카드가 엉뚱한 문장을 가리키게 된다. 감추기만 한다. */

  var FILLER = {};
  (function () {
    var list = ('oh ah aw ha haha hah heh hehe uh uhh um umm hm hmm mm mmm mhm huh eh er '
      + 'wow whoa woo yay ooh oops yeah yea yep yes yup no nope nah okay ok alright '
      + 'hey hi hello bye well right sure ow ouch shh ugh wait what').split(' ');
    for (var i = 0; i < list.length; i++) FILLER[list[i]] = true;
  })();

  /* 글자나 숫자가 든 덩어리만 낱말로 센다. 줄표 하나짜리 조각은 낱말이 아니다 */
  function lineWords(text) {
    var raw = String(text || '').split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (/[A-Za-z0-9]/.test(raw[i])) out.push(raw[i]);
    }
    return out;
  }

  /* 줄 전체가 감탄사뿐인지. "No, no, no." 나 "Wait, wait, wait." 같은 것 */
  function fillerOnly(words) {
    for (var i = 0; i < words.length; i++) {
      var parts = String(words[i]).toLowerCase().replace(/\u2019/g, "'").split(/[^a-z']+/);
      for (var p = 0; p < parts.length; p++) {
        var one = parts[p].replace(/'/g, '');
        if (one && !FILLER[one]) return false;
      }
    }
    return true;
  }

  function usableLine(s) {
    if (!s) return false;
    var w = lineWords(s.text);
    if (w.length < 3) return false;
    return !fillerOnly(w);
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
      buildPlayable();
      drawSentences();
      ensurePlayer(videoId);
      if (!video.sentences || !video.sentences.length) {
        say('This video has no sentences.');
        return;
      }
      loadProgress(profileId, videoId, function (at) {
        if (jumpTo !== null && jumpTo >= 0 && jumpTo < video.sentences.length) at = jumpTo;
        at = snapPlayable(at);
        if (at < 0) return;
        select(at, false);
        if (posAt[at]) say('Picking up at sentence ' + (posAt[at] + 1) + '.');
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

  /* 연습에 쓸 문장만 골라 자리 번호를 모아 둔다. 원래 배열은 그대로 둔다 */
  function buildPlayable() {
    playable = [];
    posAt = {};
    var list = (video && video.sentences) || [];
    for (var i = 0; i < list.length; i++) {
      if (!usableLine(list[i])) continue;
      posAt[i] = playable.length;
      playable.push(i);
    }
    // 전부 걸러졌다면 원래대로 다 보여 준다. 빈 화면보다는 낫다
    if (!playable.length) {
      for (var k = 0; k < list.length; k++) { posAt[k] = playable.length; playable.push(k); }
    }
  }

  /* 감춘 줄을 가리키는 자리 번호가 들어오면 (옛 진도나 카드) 다음 문장으로 옮긴다 */
  function snapPlayable(idx) {
    if (posAt[idx] !== undefined) return idx;
    for (var i = 0; i < playable.length; i++) if (playable[i] > idx) return playable[i];
    return playable.length ? playable[playable.length - 1] : -1;
  }

  /* 앞뒤로 옮기기. 감춘 줄은 건너뛴다 */
  function stepSentence(delta) {
    var pos = posAt[current];
    if (pos === undefined) { select(snapPlayable(current), true); return; }
    var to = pos + delta;
    if (to < 0 || to >= playable.length) return;
    select(playable[to], true);
  }

  function listLength() {
    return playable.length;
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
    $('list-btn').textContent = 'Sentences (' + playable.length + ')';
    var frag = document.createDocumentFragment();
    for (var n = 0; n < playable.length; n++) {
      (function (idx, pos) {
        var b = el('button', 'sentence');
        b.id = 'sentence-' + idx;
        b.appendChild(el('span', 'no', (pos + 1) + '.'));
        b.appendChild(document.createTextNode(list[idx].text));
        b.onclick = function () { toggleList(false); select(idx, true); };
        var li = document.createElement('li');
        li.appendChild(b);
        frag.appendChild(li);
      })(playable[n], n);
    }
    var ul = el('ul', 'list');
    ul.appendChild(frag);
    box.appendChild(ul);
    markDone();
  }

  function select(idx, play) {
    var list = (video && video.sentences) || [];
    if (idx < 0 || idx >= list.length) return;
    idx = snapPlayable(idx);
    if (idx < 0) return;
    var pos = posAt[idx];

    var old = $('sentence-' + current);
    if (old) old.className = 'sentence';
    current = idx;
    var now = $('sentence-' + current);
    if (now) now.className = 'sentence playing';
    scrollListTo(current);
    $('position').textContent = (pos + 1) + ' / ' + playable.length;
    $('position2').textContent = (pos + 1) + ' / ' + playable.length;

    resetAnswer();

    $('prev-btn').disabled = (pos === 0);
    $('next-btn').disabled = (pos === playable.length - 1);

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
    // 줄표(—) 처럼 문장부호만으로 된 조각은 비교할 낱말이 없어 ok 가 null 로 남는다.
    // 이걸 오답으로 세면 아무리 정확히 써도 만점이 안 나온다. 채점에서 뺀다.
    var right = 0, total = 0;
    for (w = 0; w < ok.length; w++) {
      if (ok[w] === null) continue;
      total++;
      if (ok[w]) right++;
    }
    return { words: A.words, ok: ok, right: right, total: total, extra: r.extra };
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

  /* 대화 카드를 영상 파일과 같은 모양으로 만들어 준다.
     `talk-3` 은 그 대화의 턴, `talk-3-w` 는 그 대화 요약의 "배울 표현" 이다.
     **한국어(ko)를 넣지 않는다** — 대화에는 한국어가 없다. 그래서 한→영 모드에는
     안 나오고 듣고 말하기·받아쓰기 재시험에만 나온다. */
  function talkSentences(pid, vid, done) {
    if (!window.Store || !Store.available()) { done(null); return; }
    var body = vid.slice(5);
    var words = /-w$/.test(body);
    var id = parseInt(words ? body.slice(0, -2) : body, 10);
    if (!id) { done(null); return; }

    Store.getTalk(pid, id, function (row) {
      if (!row) { done(null); return; }
      var out = { videoId: vid, title: 'Talk ' + id, sentences: [] };
      if (words) {
        var list = (row.summary && row.summary.words) || [];
        for (var i = 0; i < list.length; i++) {
          out.sentences.push({ i: i, text: String(list[i]).replace(/\*\*/g, '') });
        }
      } else {
        for (var t = 0; t < row.turns.length; t++) {
          var turn = row.turns[t];
          out.sentences.push({ i: t, text: turn.natural || turn.corrected, note: turn.why });
        }
      }
      done(out.sentences.length ? out : null);
    }, function () { done(null); });
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
        // 대화에서 담은 카드는 **저장소에 파일이 없다** — 대화는 기기 안에만 두기 때문이다
        // (ROADMAP 2단계). 그래서 기기에서 찾는 갈래를 따로 탄다.
        // 이걸 빼먹으면 카드는 담기는데 열면 빈 화면이 나온다.
        if (vid.indexOf('talk-') === 0) {
          talkSentences(pid, vid, function (data) { videos[vid] = data; step(); });
          return;
        }
        getJSON(sentenceFileFor(pid, vid), function (data) {
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
      // 하루 문장은 읽어 줄 수 있어야만 Play 를 만든다 (SPEC 9 — 기능 감지)
      if (!isDailyId(row.card.videoId) || canSpeak()) {
        var play = el('button', 'half', 'Play');
        play.onclick = function () { playCardAudio(row); };
        btns.appendChild(play);
      }
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
    var daily = isDailyId(row.card.videoId);
    var ob = el('button', 'half', daily ? 'Open in Daily' : 'Open in the video');
    ob.onclick = function () {
      go(daily
        ? '#/' + pid + '/' + routeOfKind(kindOfId(row.card.videoId)) + '/'
            + row.card.videoId.slice(6) + '/' + row.card.i
        : '#/' + pid + '/' + row.card.videoId + '/' + row.card.i);
    };
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
    // 하루 문장에는 영상이 없다. 폰에 내장된 목소리로 읽어 준다
    if (isDailyId(row.card.videoId)) {
      if (!speakText(row.s.text)) say('This browser cannot read it aloud. Press Show instead.');
      return;
    }
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

  /* ---------------------------------------------------------------- 하루 다섯 문장 (ROADMAP 1단계)

     한국어를 보고 영어로 옮겨 말하는 연습. 문장은 매일 아침 GitHub 가 만들어 넣는다.
     채점기·녹음·문장카드는 받아쓰기 쪽 것을 그대로 쓴다. */

  var dailyIndex = [];      // [{date, count}] — 새 날짜가 앞
  var dailyDay = null;      // 지금 보고 있는 날의 파일
  var dailyAt = 0;
  var dailyHeard = '';      // 음성인식이 받아적은 내 말
  var dailyTyped = '';      // 대사 갈래에서 영어로 쳐 본 것
  var dailyResult = null;   // 그 채점 결과. 다시 그려도 지워지지 않게 남긴다
  var dailyShown = false;   // 정답을 봤는지
  var dailyRecording = false;
  var dailyProgress = null;
  var dailyKind = 'made';   // 'made' = AI 가 만든 문장, 'shows' = 등록한 영상의 실제 대사

  var DAILY_TABS = [
    { id: 'made',  route: 'daily', name: 'Written' },
    { id: 'shows', route: 'shows', name: 'Shows' }
  ];

  function dailyFile(pid, date, kind) {
    return 'data/daily/' + pid + '/' + date + ((kind || dailyKind) === 'shows' ? '-shows' : '') + '.json';
  }

  /* 카드가 가리키는 문장이 영상인지 하루 문장인지에 따라 파일 자리가 다르다 */
  function sentenceFileFor(pid, videoId) {
    var id = String(videoId || '');
    // daily-s001 은 묶음 파일. daily-2026-08-23 은 예전 날짜 파일 (담아 둔 카드가 가리킨다)
    if (id.indexOf('daily-s') === 0) return 'data/daily/' + pid + '/sets/' + id.slice(6) + '.json';
    if (id.indexOf('daily-') === 0) return dailyFile(pid, id.slice(6), 'made');
    if (id.indexOf('shows-') === 0) return dailyFile(pid, id.slice(6), 'shows');
    return 'data/videos/' + pid + '/' + id + '.json';
  }

  function isDailyId(videoId) {
    var id = String(videoId || '');
    return id.indexOf('daily-') === 0 || id.indexOf('shows-') === 0;
  }

  function kindOfId(videoId) {
    return String(videoId || '').indexOf('shows-') === 0 ? 'shows' : 'made';
  }

  function routeOfKind(kind) { return kind === 'shows' ? 'shows' : 'daily'; }

  /* 폰에 내장된 목소리로 읽어 준다. 없는 기기에서는 그 버튼을 아예 안 만든다 (SPEC 9) */
  function canSpeak() {
    return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  function speakText(text) {
    if (!canSpeak() || !text) return false;
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = slow ? 0.7 : 0.95;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function dailySay(msg) {
    var s = $('daily-status');
    if (s) s.textContent = msg;
  }

  /* 날짜 문자열 두 개의 날 수 차이 */
  function daysApart(a, b) {
    var x = Date.parse(a + 'T00:00:00'), y = Date.parse(b + 'T00:00:00');
    if (isNaN(x) || isNaN(y)) return 0;
    return Math.round((y - x) / 86400000);
  }

  /* 며칠째 새 문장이 안 들어왔는지. 만드는 쪽이 멈추면 조용히 넘어가면 안 된다 */
  function dailyStaleDays() {
    if (!dailyIndex.length || !window.Store) return 0;
    var gap = daysApart(dailyIndex[0].date, Store.today());
    return gap > 0 ? gap : 0;
  }

  var SHOWS_EMPTY = 'No lines from your videos yet.\n'
    + 'These are real lines taken from the videos you registered, so you need at least one '
    + 'video with usable captions.\n'
    + 'Register a drama or film clip from your PC and they appear here the next morning.';

  var DAILY_EMPTY = 'No sentences yet.\n'
    + 'A new set of five is made every morning and appears here.\n'
    + 'If nothing shows up for a few days, the daily maker has stopped.';

  /* 창고에 쌓인 묶음 목록 (날짜 없음) */
  var dailySets = [];
  var dailyPlans = [];        // 공부한 날들 [{date, setIds}]
  var dailyDate = '';         // 지금 보고 있는 공부한 날

  function showDaily(pid, date, idx) {
    setProfileId(pid);
    show('daily');
    var box = $('daily-body');
    notice(box, 'Loading…');

    if (dailyKind === 'shows') { showShows(pid, date, idx); return; }

    getJSON('data/daily/' + pid + '/sets.json', function (rows) {
      dailySets = rows || [];
      if (!dailySets.length) { emptyDaily(pid, box); return; }
      if (!window.Store || !Store.available()) {
        // 기록을 못 쓰는 브라우저에서는 첫 묶음만 보여 준다
        dailyPlans = [];
        openSet(pid, dailySets[0].id, Store && Store.today ? Store.today() : '', idx);
        return;
      }
      Store.listPlans(pid, function (plans) {
        dailyPlans = plans || [];
        // 날짜 자리에 묶음 번호가 오면 그 묶음을 바로 연다 (카드나 건너뛴 것에서 올 때)
        if (/^s\d+$/.test(date || '')) {
          openSet(pid, date, window.Store ? Store.today() : '', idx);
          return;
        }
        planFor(pid, date || (window.Store ? Store.today() : ''), idx);
      }, function () {
        dailyPlans = [];
        openSet(pid, dailySets[0].id, '', idx);
      });
    }, function (why) {
      if (why !== 'missing') { notice(box, why, true); return; }
      emptyDaily(pid, box);
    });
  }

  function emptyDaily(pid, box) {
    justTabs(pid);
    clear(box);
    notice2(box, DAILY_EMPTY);
  }

  /* 보여 줄 문장이 없을 때. 탭만 남기고 장면 재생기는 접는다 */
  function justTabs(pid) {
    var head = $('daily-head');
    clear(head);
    head.appendChild(dailyTabs(pid, ''));
    setupClip(pid, null);
  }

  function emptyShows(pid) {
    var box = $('daily-body');
    justTabs(pid);
    clear(box);
    notice2(box, SHOWS_EMPTY);
  }

  /* 그 날에 하던 묶음이 있으면 그것을, 없으면 아직 안 쓴 묶음을 하나 꺼내 준다.
     날짜는 "공부한 날" 이다 — 문장을 만든 날이 아니다 (운영자 결정). */
  function showShows(pid, date, idx) {
    getJSON('data/daily/' + pid + '/index.json', function (rows) {
      dailyIndex = rows || [];
      var any = false;
      for (var h = 0; h < dailyIndex.length; h++) if (dailyIndex[h].hasShows) any = true;
      if (!any) {
        emptyShows(pid); return;
      }
      if (!window.Store || !Store.available()) {
        dailyPlans = [];
        var one = unusedShow();
        if (one) openShow(pid, one, '', idx);
        else emptyShows(pid);
        return;
      }
      Store.listPlans(pid, function (plans) {
        dailyPlans = plans || [];
        planFor(pid, date || Store.today(), idx);
      }, function () {
        dailyPlans = [];
        var two = unusedShow();
        if (two) openShow(pid, two, '', idx);
        else emptyShows(pid);
      });
    }, function () {
      emptyShows(pid);
    });
  }

  function planKey() { return dailyKind === 'shows' ? 'showIds' : 'setIds'; }

  function planFor(pid, date, idx) {
    var k = planKey();
    var mine = null;
    for (var i = 0; i < dailyPlans.length; i++) if (dailyPlans[i].date === date) mine = dailyPlans[i];

    var got = mine && mine[k] && mine[k].length ? mine[k][mine[k].length - 1] : null;
    if (got) {
      if (dailyKind === 'shows') openShow(pid, got, date, idx);
      else openSet(pid, got, date, idx);
      return;
    }

    var fresh = dailyKind === 'shows' ? unusedShow() : unusedSet();
    if (!fresh) { noMoreSets(pid, date); return; }
    assignSet(pid, date, fresh, function () {
      if (dailyKind === 'shows') openShow(pid, fresh, date, idx);
      else openSet(pid, fresh, date, idx);
    });
  }

  /* 아직 어느 날에도 안 쓴 영상 대사 묶음 (파일 이름이 곧 번호다) */
  function unusedShow() {
    var used = {};
    for (var p = 0; p < dailyPlans.length; p++) {
      var ids = dailyPlans[p].showIds || [];
      for (var q = 0; q < ids.length; q++) used[ids[q]] = true;
    }
    for (var i = dailyIndex.length - 1; i >= 0; i--) {
      if (dailyIndex[i].hasShows && !used[dailyIndex[i].date]) return dailyIndex[i].date;
    }
    return null;
  }

  function openShow(pid, showId, date, idx) {
    dailyDate = date;
    getJSON(dailyFile(pid, showId, 'shows'), function (day) {
      if (!day || !day.sentences || !day.sentences.length) { emptyShows(pid); return; }
      dailyDay = day;
      dailyAt = 0;
      if (idx !== null && idx !== undefined && !isNaN(idx)) {
        dailyAt = Math.max(0, Math.min(day.sentences.length - 1, idx));
      }
      resetDailyAnswer();
      loadDailyProgress(pid, day.videoId, function () { drawDaily(pid); });
    }, function () {
      notice($('daily-body'), 'That set could not be loaded.', true);
    });
  }

  /* 아직 어느 날에도 안 쓴 묶음 중 제일 오래된 것 */
  function unusedSet() {
    var used = {};
    for (var p = 0; p < dailyPlans.length; p++) {
      for (var q = 0; q < dailyPlans[p].setIds.length; q++) used[dailyPlans[p].setIds[q]] = true;
    }
    for (var i = 0; i < dailySets.length; i++) {
      if (!used[dailySets[i].id]) return dailySets[i].id;
    }
    return null;
  }

  function assignSet(pid, date, setId, done) {
    if (!window.Store || !Store.available()) { done(); return; }
    var k = planKey();
    Store.getPlan(pid, date, function (row) {
      if (!row[k]) row[k] = [];
      for (var i = 0; i < row[k].length; i++) if (row[k][i] === setId) { done(); return; }
      row[k].push(setId);
      Store.savePlan(row, function () {
        var found = false;
        for (var p = 0; p < dailyPlans.length; p++) {
          if (dailyPlans[p].date === date) { dailyPlans[p] = row; found = true; }
        }
        if (!found) dailyPlans.unshift(row);
        dailyPlans.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        done();
      }, done);
    }, done);
  }

  function openSet(pid, setId, date, idx) {
    dailyDate = date;
    getJSON('data/daily/' + pid + '/sets/' + setId + '.json', function (day) {
      if (!day || !day.sentences || !day.sentences.length) { emptyDaily(pid, $('daily-body')); return; }
      dailyDay = day;
      dailyAt = 0;
      if (idx !== null && idx !== undefined && !isNaN(idx)) {
        dailyAt = Math.max(0, Math.min(day.sentences.length - 1, idx));
      }
      resetDailyAnswer();
      loadDailyProgress(pid, day.videoId, function () { drawDaily(pid); });
    }, function () {
      notice($('daily-body'), 'That set could not be loaded.', true);
    });
  }

  function noMoreSets(pid, date) {
    var head = $('daily-head');
    var box = $('daily-body');
    clear(head);
    clear(box);
    head.appendChild(dailyTabs(pid, ''));
    head.appendChild(dateRow(pid));
    setupClip(pid, null);
    var n = el('div', 'notice');
    n.appendChild(document.createTextNode(
      'Every set has been used. A new one is made every morning — or open the maker page '
      + 'and press Run workflow to make one now.'));
    var b = el('div', 'buttons');
    var open = el('button', 'half', 'Open the maker page');
    open.onclick = function () { window.open(MAKE_URL, '_blank'); };
    b.appendChild(open);
    n.appendChild(b);
    box.appendChild(n);
    var st = el('div', 'status', '');
    st.id = 'daily-status';
    box.appendChild(st);
  }

  /* 무엇으로 연습할지 고르는 탭 */
  function dailyTabs(pid, date) {
    var wrap = el('div', 'modes');
    for (var i = 0; i < DAILY_TABS.length; i++) {
      (function (t) {
        var b = el('button', 'small' + (t.id === dailyKind ? ' on' : ''), t.name);
        b.onclick = function () {
          go('#/' + pid + '/' + t.route + (date ? '/' + date : ''));
        };
        wrap.appendChild(b);
      })(DAILY_TABS[i]);
    }
    return wrap;
  }

  /* 공부한 날 고르기.

     최근 며칠은 단추로 바로 누르고, 그보다 오래된 것은 목록에서 고른다.
     달력을 띄우는 것도 생각해 봤지만 이 앱에는 안 맞는다 — 공부한 날은 드문드문
     있어서 달력을 열면 대부분이 빈 칸이고, 폰에서 자리도 많이 먹는다.
     목록은 공부한 날만 나오고 몇 백 개가 되어도 그대로 돌아간다. */
  var DATE_CHIPS = 5;

  function studyDays() {
    var k = planKey();
    var out = [], seen = {};
    for (var i = 0; i < dailyPlans.length; i++) {
      var one = dailyPlans[i];
      if (!one[k] || !one[k].length) continue;      // 그 갈래를 안 한 날은 뺀다
      if (seen[one.date]) continue;
      seen[one.date] = true;
      out.push(one.date);
    }
    out.sort(function (x, y) { return x < y ? 1 : -1; });
    return out;
  }

  function shortDate(d) { return String(d).slice(5).replace('-', '/'); }

  function dateRow(pid) {
    var wrap = el('div', 'dates');
    var today = window.Store ? Store.today() : '';
    var days = studyDays();
    var route = routeOfKind(dailyKind);

    // 오늘은 늘 맨 앞. 아직 안 한 날이어도 눌러서 시작할 수 있어야 한다
    var list = [];
    if (today) list.push(today);
    for (var i = 0; i < days.length; i++) if (days[i] !== today) list.push(days[i]);

    for (var c = 0; c < list.length && c < DATE_CHIPS; c++) {
      (function (d) {
        var b = el('button', 'small' + (d === dailyDate ? ' on' : ''),
          d === today ? 'Today' : shortDate(d));
        b.onclick = function () { go('#/' + pid + '/' + route + '/' + d); };
        wrap.appendChild(b);
      })(list[c]);
    }

    if (list.length > DATE_CHIPS) {
      var sel = document.createElement('select');
      sel.className = 'datepick';
      var head = document.createElement('option');
      head.value = '';
      head.appendChild(document.createTextNode('Earlier\u2026 (' + (list.length - DATE_CHIPS) + ')'));
      sel.appendChild(head);
      for (var j = DATE_CHIPS; j < list.length; j++) {
        var o = document.createElement('option');
        o.value = list[j];
        o.appendChild(document.createTextNode(list[j]));
        if (list[j] === dailyDate) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = function () { if (this.value) go('#/' + pid + '/' + route + '/' + this.value); };
      wrap.appendChild(sel);
    }
    return wrap;
  }

  function loadDailyProgress(pid, videoId, done) {
    dailyProgress = null;
    if (!window.Store || !Store.available()) { done(); return; }
    Store.getProgress(pid, videoId, function (row) {
      dailyProgress = row;
      done();
    }, function () { done(); });
  }

  function resetDailyAnswer() {
    dailyHeard = '';
    dailyTyped = '';
    dailyResult = null;
    dailyShown = false;
    if (window.Recorder && dailyRecording) { Recorder.discard(); }
    dailyRecording = false;
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  }

  /* ------------------------------------------------- 대사가 나온 장면 (SPEC 6-2)

     드라마 대사는 배우가 실제로 한 말이라 그 자리가 영상에 있다. 정답을 펴기 전에
     그 장면을 그대로 틀어 준다 — 상황을 보고 나서 옮기는 것이 훨씬 낫기 때문이다.
     **저절로 재생하지는 않는다.** 한국어만 보고 하고 싶은 날에는 그냥 지나칠 수 있어야 한다.

     연습 화면 재생기와 따로 만든다. iframe 은 화면 사이를 옮기면 다시 읽히기 때문에
     하나를 두 화면이 나눠 쓸 수가 없다. 대신 여기서도 재생기는 한 번만 만들고
     영상은 cueVideoById 로 갈아 끼운다. */

  var clip = null;          // 장면 재생기
  var clipReady = false;
  var clipWant = null;      // 유튜브 API 가 아직 안 왔을 때 기다리는 영상
  var clipTimer = null;     // 끝 지점 감시
  var clipEnd = 0;
  var clipStartedAt = 0;
  var clipSource = {};      // 영상 ID → 그 영상의 문장 목록. 한 번만 읽는다
  var clipNow = null;       // 지금 화면에 붙어 있는 장면 {line, scene}
  var clipRepeat = false;   // 켜 두면 튼 자리를 계속 되풀이한다
  var clipFrom = null;      // 되풀이할 때 돌아갈 자리
  var clipKey = '';         // 그 장면이 어느 문장의 것인지 (영상ID|자리번호)

  function clipStopWatch() {
    if (clipTimer) { clearInterval(clipTimer); clipTimer = null; }
  }

  function clipCover(on) {
    var c = $('daily-cover');
    if (c) c.className = on ? 'cover' : 'cover off';
  }

  /* 자막이 켜지면 정답이 화면에 그대로 나온다. setOption 은 부르면 안 된다 — 도로 올라온다 */
  function clipKillCaptions() {
    if (!clip) return;
    try { clip.unloadModule('captions'); } catch (e) {}
    try { clip.unloadModule('cc'); } catch (e) {}
  }

  function clipKillSoon() {
    clipKillCaptions();
    setTimeout(clipKillCaptions, 400);
    setTimeout(clipKillCaptions, 1200);
  }

  function clipLoadedId() {
    try { return (clip.getVideoData() || {}).video_id || ''; } catch (e) { return ''; }
  }

  function clipEnsure(videoId) {
    if (!apiReady) { clipWant = videoId; return; }
    if (clip) {
      if (clipLoadedId() !== videoId) {
        clipStopWatch();
        clipCover(true);
        try { clip.cueVideoById(videoId); } catch (e) {}
        clipKillSoon();
      }
      return;
    }
    clip = new YT.Player('daily-player', {
      width: '100%',
      height: '100%',
      videoId: videoId,
      playerVars: {
        playsinline: 1, rel: 0, modestbranding: 1, controls: 0,
        disablekb: 1, fs: 0, iv_load_policy: 3, cc_load_policy: 0
      },
      events: {
        onReady: function () { clipReady = true; clipKillSoon(); },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.PLAYING) { clipCover(false); clipKillSoon(); }
          else if (e.data === YT.PlayerState.ENDED) { clipStopWatch(); clipCover(true); }
          else if (e.data === YT.PlayerState.PAUSED) {
            // 자리를 옮기는 순간에도 잠깐 멈춤으로 잡힌다. 사용자가 멈춘 것이 아니다
            if ((new Date()).getTime() - clipStartedAt > 800) { clipStopWatch(); clipCover(true); }
          }
        },
        onError: function () {
          clipStopWatch();
          dailySay('This scene could not be played.');
        }
      }
    });
  }

  function clipPlay(from, to) {
    if (!clipReady) { dailySay('The scene is still loading. Try again in a moment.'); return; }
    clipStopWatch();
    clipStartedAt = (new Date()).getTime();
    clipEnd = to;
    clipFrom = Math.max(0, from);
    // 순서가 중요하다 — 재생을 먼저 시키고 자리를 옮긴다. 반대로 하면 모바일 사파리가
    // 재생 명령을 씹어서 자리만 옮겨지고 소리가 안 난다
    clip.playVideo();
    clip.seekTo(Math.max(0, from), true);
    clip.setPlaybackRate(slow ? 0.75 : 1);
    var armed = false, waited = 0;
    clipTimer = setInterval(function () {
      if (!clip || typeof clip.getCurrentTime !== 'function') return;
      var t = clip.getCurrentTime();
      if (!armed) {
        waited += TICK_MS;
        if (t < clipEnd - STOP_MARGIN || waited > 3000) armed = true;
        return;
      }
      if (t >= clipEnd - STOP_MARGIN) {
        // 멈췄다 다시 트는 게 아니라 자리만 되돌린다. 멈추면 유튜브가 영상 위에
        // 공유 단추를 띄우고 가림막이 깜빡여서 흐름이 끊긴다
        if (clipRepeat && clipFrom !== null) {
          clipStartedAt = (new Date()).getTime();
          armed = false;
          waited = 0;
          clip.seekTo(clipFrom, true);
          clip.playVideo();
          return;
        }
        clipStopWatch();
        clip.pauseVideo();
      }
    }, TICK_MS);
    clipNudge(0);
  }

  function clipNudge(tries) {
    if (tries > 6) return;
    setTimeout(function () {
      if (!clipTimer || !clip || typeof clip.getPlayerState !== 'function') return;
      var st = clip.getPlayerState();
      if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) {
        clip.playVideo();
        clipNudge(tries + 1);
      }
    }, 250);
  }

  function toggleClipRepeat() {
    clipRepeat = !clipRepeat;
    var b = $('clip-repeat');
    b.className = clipRepeat ? 'half on' : 'half';
    b.textContent = clipRepeat ? 'Repeat on' : 'Repeat';
    dailySay(clipRepeat
      ? 'Repeat on. What you play goes round and round until you turn this off.'
      : 'Repeat off. It stops at the end of this round.');
  }

  /* 앞뒤로 한 마디씩 붙여 장면을 만든다. 그 대사만 틀면 무슨 상황인지 알 수 없다.
     "Yeah." 같은 토막은 건너뛰고 말이 되는 줄까지 간다 — 0.3초짜리 앞 줄은 장면이 아니다. */
  function sceneAround(list, i) {
    var from = i, to = i;
    for (var a = i - 1; a >= 0; a--) { if (usableLine(list[a])) { from = a; break; } }
    for (var b = i + 1; b < list.length; b++) { if (usableLine(list[b])) { to = b; break; } }
    return { from: from, to: to };
  }

  /* 영상에 그 자리가 있는 문장인지. 지어낸 문장에는 없다 */
  function hasScene(s) {
    return !!(s && s.from && s.from.videoId && s.start !== null && s.start !== undefined);
  }

  /* 몇 번째로 하는 것인지 붙인다. 순서가 보여야 흐름대로 하게 된다 */
  function stepRow(n, text, cls) {
    var d = el('div', cls || 'step');
    d.appendChild(el('span', 'n', String(n)));
    d.appendChild(document.createTextNode(text));
    return d;
  }

  /* 이 문장에 붙일 장면을 준비한다. 대사가 아니거나 온 곳을 모르면 통째로 감춘다 */
  function setupClip(pid, s) {
    var box = $('daily-clip');
    if (!box) return;
    var src = s && s.from;
    var ok = hasScene(s);
    var key = ok ? (src.videoId + '|' + src.i) : '';

    // 같은 문장을 다시 그린 것뿐이면 손대지 않는다. 정답을 펴는 순간
    // 보고 있던 장면이 멈춰 버리면 안 된다
    if (key && key === clipKey && clipNow) return;
    clipKey = key;

    clipStopWatch();
    clipCover(true);
    if (clip && clipReady) { try { clip.pauseVideo(); } catch (e) {} }
    clipNow = null;
    $('clip-scene').disabled = true;
    $('clip-one').disabled = true;

    if (!ok) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    $('clip-note').textContent = 'Loading the scene\u2026';
    clipEnsure(src.videoId);

    if (clipSource[src.videoId]) { clipArm(s); return; }
    getJSON('data/videos/' + pid + '/' + src.videoId + '.json', function (data) {
      clipSource[src.videoId] = (data && data.sentences) || [];
      if (dailyDay && dailyDay.sentences[dailyAt] === s) clipArm(s);
    }, function () {
      clipSource[src.videoId] = [];
      if (dailyDay && dailyDay.sentences[dailyAt] === s) clipArm(s);
    });
  }

  function clipArm(s) {
    var list = clipSource[s.from.videoId] || [];
    var one = list[s.from.i];
    // 영상 파일을 못 읽었거나 문장이 옮겨졌으면 그 대사만 틀어 준다
    var same = one && String(one.text || '').replace(/\s+/g, ' ') === String(s.text).replace(/\s+/g, ' ');
    clipNow = { line: { start: s.start, end: s.end }, scene: null };
    if (same) {
      var r = sceneAround(list, s.from.i);
      if (r.from !== s.from.i || r.to !== s.from.i) {
        clipNow.scene = { start: list[r.from].start, end: list[r.to].end };
      }
    }
    $('clip-note').textContent = clipNow.scene
      ? 'The line you are practising is the middle one.'
      : 'Only this line — the lines around it could not be found.';
    $('clip-scene').disabled = false;
    $('clip-one').disabled = false;
    $('clip-scene').onclick = function () {
      var r = clipNow.scene || clipNow.line;
      clipPlay(r.start - lead, r.end + TAIL);
    };
    $('clip-one').onclick = function () {
      clipPlay(clipNow.line.start - lead, clipNow.line.end + TAIL);
    };
    $('daily-cover').onclick = $('clip-scene').onclick;
  }

  function drawDaily(pid) {
    var head = $('daily-head');
    var box = $('daily-body');
    clear(head);
    clear(box);
    head.appendChild(dailyTabs(pid, ''));
    var day = dailyDay;
    var s = day.sentences[dailyAt];

    head.appendChild(dateRow(pid));

    var mark = dailyProgress && dailyProgress.sentences ? dailyProgress.sentences[dailyAt] : null;
    var where = (dailyAt + 1) + ' of ' + day.sentences.length;
    if (dailyKind === 'made') {
      where += ' · ' + (day.title || 'Set');
    }
    if (mark === 'ok') where += ' · done';
    else if (mark === 'miss') where += ' · tried';
    head.appendChild(el('div', 'count', where));

    if (s.situation) head.appendChild(el('div', 'hint', s.situation));

    // 장면은 한국어보다 위에 둔다. 보고 나서 옮기는 것이 순서다.
    // 장면 칸이 있으면 그것이 1번이다 (번호는 index.html 에 적혀 있다)
    setupClip(pid, s);
    var step = hasScene(s) ? 1 : 0;

    step++;
    box.appendChild(stepRow(step, dailyKind === 'shows'
      ? 'Check the meaning in Korean' : 'Read the Korean'));
    box.appendChild(el('div', 'kotask', s.ko || ''));

    /* 말하기 — 못 하는 기기에서는 이 줄을 통째로 안 만든다 (SPEC 9) */
    if (window.Recorder && Recorder.canRecord()) {
      var speak = el('div', 'speak on');
      step++;
      speak.appendChild(stepRow(step, 'Say it in English', 'rowlabel'));
      var sbtn = el('div', 'buttons');

      var rec = el('button', dailyRecording ? 'half rec-on' : 'half',
        dailyRecording ? 'Stop' : 'Record');
      rec.id = 'daily-rec';
      rec.onclick = function () { toggleDailyRecord(pid); };
      sbtn.appendChild(rec);

      var mine = el('button', 'half', 'Play mine');
      mine.id = 'daily-mine';
      mine.disabled = !(window.Recorder && Recorder.lastUrl());
      mine.onclick = function () {
        var au = $('daily-audio');
        if (!au || !au.getAttribute('src')) return;
        try { au.currentTime = 0; au.play(); } catch (e) { dailySay('Could not play the recording.'); }
      };
      sbtn.appendChild(mine);
      speak.appendChild(sbtn);

      var au2 = document.createElement('audio');
      au2.id = 'daily-audio';
      au2.preload = 'none';
      if (window.Recorder && Recorder.lastUrl()) au2.src = Recorder.lastUrl();
      speak.appendChild(au2);

      var heard = el('div', 'heard');
      heard.id = 'daily-heard';
      if (dailyHeard) heard.appendChild(document.createTextNode('You said: ' + dailyHeard));
      speak.appendChild(heard);

      if (!Recorder.canTranscribe()) {
        speak.appendChild(el('div', 'hint',
          'This browser cannot write down what you say, so just say it out loud '
          + 'and compare with the answer.'));
      }
      box.appendChild(speak);
    } else {
      box.appendChild(el('div', 'notice',
        'This browser cannot use the microphone. Say the sentence out loud anyway, '
        + 'then press Show answer.'));
    }

    /* 채점은 하지 않는다. 이건 옮겨 말하기 연습이라 정답이 하나가 아니고,
       글자로 맞히는 것은 목적이 아니다 (운영자 결정). 말해 보고 견주기만 한다.

       다만 드라마 대사는 배우가 실제로 한 말이라 정답이 하나다. 그쪽에서는 쳐 보고
       채점까지 한다 (운영자 결정). */
    if (dailyKind === 'shows') { step++; box.appendChild(dailyWriteBlock(pid, s, step)); }

    step++;
    box.appendChild(stepRow(step, 'Check the answer'));
    var row = el('div', 'buttons');
    var rb = el('button', 'primary', dailyShown ? 'Answer shown' : 'Show answer');
    rb.disabled = dailyShown;
    rb.onclick = function () { revealDaily(pid); };
    row.appendChild(rb);
    var sc = el('button', 'half', 'Save card');
    sc.id = 'daily-save';
    sc.onclick = function () { saveDailyCard(pid); };
    row.appendChild(sc);
    box.appendChild(row);

    // 하기 싫은 문장에 붙잡혀 있을 이유가 없다. 건너뛴 것은 따로 모아 둔다
    var more = el('div', 'buttons');
    var mb = el('button', 'half', 'Skip');
    mb.id = 'daily-more';
    mb.onclick = function () { skipDaily(pid); };
    more.appendChild(mb);
    box.appendChild(more);

    if (dailyShown) box.appendChild(dailyAnswerBlock(s));

    var nav = el('div', 'buttons');
    var prev = el('button', 'half', '‹ Previous');
    prev.disabled = (dailyAt === 0);
    prev.onclick = function () { dailyGo(pid, dailyAt - 1); };
    nav.appendChild(prev);
    var next = el('button', 'half', 'Next ›');
    next.disabled = (dailyAt >= day.sentences.length - 1);
    next.onclick = function () { dailyGo(pid, dailyAt + 1); };
    nav.appendChild(next);
    box.appendChild(nav);

    var st = el('div', 'status', '');
    st.id = 'daily-status';
    box.appendChild(st);

    window.scrollTo(0, 0);
  }

  /* 영어로 쳐 보는 칸. 대사 갈래에서만 그린다.
     Check 를 누르면 받아쓰기 화면과 같은 방식으로 정답이 나오고 틀린 낱말만 칠해진다. */
  function dailyWriteBlock(pid, s, step) {
    var write = el('div', 'speak');
    write.appendChild(stepRow(step, 'Write it in English', 'rowlabel'));

    var ta = document.createElement('textarea');
    ta.id = 'daily-input';
    ta.rows = 2;
    ta.value = dailyTyped;
    ta.setAttribute('placeholder', 'Type the line');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('spellcheck', 'false');
    write.appendChild(ta);

    var b = el('div', 'buttons');
    var check = el('button', 'half', 'Check');
    check.onclick = function () { checkDaily(pid); };
    b.appendChild(check);
    write.appendChild(b);

    var now = el('div', 'now empty');
    now.id = 'daily-now';
    now.appendChild(document.createTextNode('Write what you think the line was, then press Check.'));
    write.appendChild(now);

    // 다시 그려도 방금 본 채점 결과가 사라지지 않게 한다
    if (dailyResult) drawDailyGraded(dailyResult, now);
    return write;
  }

  function checkDaily(pid) {
    var s = dailyDay && dailyDay.sentences[dailyAt];
    if (!s) return;
    var ta = $('daily-input');
    dailyTyped = ta ? ta.value : '';
    if (!dailyTyped.replace(/\s/g, '')) {
      dailySay('Write something first, or press Show answer.');
      return;
    }
    dailyResult = grade(s.text, dailyTyped, strict);
    drawDailyGraded(dailyResult);
    recordDailyResult(pid, dailyResult);
    dailySay(dailyResult.right + ' of ' + dailyResult.total + ' words correct.');
  }

  function drawDailyGraded(r, where) {
    var box = where || $('daily-now');
    if (!box) return;
    clear(box);
    box.className = 'now';
    for (var i = 0; i < r.words.length; i++) {
      box.appendChild(el('span', (r.ok[i] === null || r.ok[i]) ? 'w' : 'w bad', r.words[i]));
      box.appendChild(document.createTextNode(' '));
    }
    if (r.extra.length) {
      box.appendChild(el('div', 'extra', 'Not in the line: ' + r.extra.join(', ')));
    }
  }

  /* 대사는 정답이 하나라 맞고 틀림을 남긴다. 틀린 낱말은 오답 리포트의 재료다 (SPEC 4-3) */
  function recordDailyResult(pid, r) {
    if (!window.Store || !Store.available() || !dailyProgress || !dailyDay) return;
    var correct = (r.right === r.total);
    dailyProgress.at = dailyAt;
    var was = dailyProgress.sentences[dailyAt];
    if (!was || was === 'skip') dailyProgress.sentences[dailyAt] = correct ? 'ok' : 'miss';
    Store.saveProgress(dailyProgress, noteStorage);
    Store.bumpDay(pid, noteStorage);
    if (correct) return;
    var missed = [];
    for (var i = 0; i < r.words.length; i++) {
      if (r.ok[i]) continue;
      var w = r.words[i].replace(/^[^A-Za-z0-9']+/, '').replace(/[^A-Za-z0-9']+$/, '');
      if (w) missed.push(w);
    }
    Store.addMisses(pid, dailyDay.videoId, dailyAt, missed, noteStorage);
  }

  /* 정답 · 다른 표현 · 설명. 정답을 보기 전에는 그리지 않는다 */
  function dailyAnswerBlock(s) {
    var wrap = el('div', 'answer');
    wrap.appendChild(el('div', 'rowlabel', 'Answer'));
    wrap.appendChild(el('div', 'ans', s.text));

    if (canSpeak()) {
      var b = el('div', 'buttons');
      var listen = el('button', 'half', 'Listen');
      listen.onclick = function () {
        if (!speakText(s.text)) dailySay('This browser could not read it aloud.');
      };
      b.appendChild(listen);
      var slowb = el('button', 'half', 'Listen slowly');
      slowb.onclick = function () {
        var was = slow; slow = true;
        if (!speakText(s.text)) dailySay('This browser could not read it aloud.');
        slow = was;
      };
      b.appendChild(slowb);
      wrap.appendChild(b);
    }

    // 장면은 위에서 이미 들을 수 있다. 여기서는 그 영상 전체로 건너간다
    if (s.from && s.from.videoId) {
      var open = el('div', 'buttons');
      var ob = el('button', 'half', 'Practise this video');
      ob.onclick = function () { go('#/' + profileId + '/' + s.from.videoId + '/' + s.from.i); };
      open.appendChild(ob);
      wrap.appendChild(open);
    }

    if (s.alts && s.alts.length) {
      wrap.appendChild(el('div', 'rowlabel', 'Another way to say it'));
      for (var a = 0; a < s.alts.length; a++) {
        wrap.appendChild(altRow(s.alts[a]));
      }
    }
    if (s.note) {
      wrap.appendChild(el('div', 'rowlabel', 'Note'));
      var note = el('div', 'note');
      note.appendChild(withKeys(s.note));
      wrap.appendChild(note);
    }
    return wrap;
  }

  /* 말투를 바꾼 표현 한 줄. 옛 파일은 alts 가 그냥 글이었으므로 둘 다 읽는다 */
  function altRow(alt) {
    var row = el('div', 'alt');
    var text = alt, style = '';
    if (alt && typeof alt === 'object') { text = alt.text; style = alt.style || ''; }
    if (style === 'casual' || style === 'formal') {
      row.appendChild(el('span', 'tag ' + style, style === 'casual' ? 'Casual' : 'Formal'));
    }
    row.appendChild(document.createTextNode(text || ''));
    return row;
  }

  /* **이렇게** 감싼 대목을 강조해서 그린다. 배울 표현이 눈에 띄어야 한다.
     별표가 짝이 안 맞아도 글이 사라지지는 않게 둔다. */
  function withKeys(text) {
    var wrap = el('span', null);
    var parts = String(text || '').split('**');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (i % 2 === 1) wrap.appendChild(el('b', 'key', parts[i]));
      else wrap.appendChild(document.createTextNode(parts[i]));
    }
    return wrap;
  }

  function nextUnseen(from) {
    if (!dailyDay) return -1;
    var done = (dailyProgress && dailyProgress.sentences) || {};
    var n = dailyDay.sentences.length;
    for (var i = 0; i < n; i++) {
      var at = (from + 1 + i) % n;
      if (!done[at]) return at;
    }
    return -1;
  }

  function unseenCount() {
    if (!dailyDay) return 0;
    var done = (dailyProgress && dailyProgress.sentences) || {};
    var left = 0;
    for (var i = 0; i < dailyDay.sentences.length; i++) if (!done[i]) left++;
    return left;
  }

  /* 새로 만들라고 시키는 곳. 앱에서 직접 못 하므로 그 화면을 열어 준다 */
  var MAKE_URL = 'https://github.com/BH2513/dictation/actions/workflows/daily-sentences.yml';

  function dailyGo(pid, idx) {
    if (!dailyDay || idx < 0 || idx >= dailyDay.sentences.length) return;
    dailyAt = idx;
    resetDailyAnswer();
    drawDaily(pid);
  }

  /* 건너뛰기. 하기 싫은 문장에 붙잡혀 있을 이유가 없다.
     건너뛴 것은 'skip' 으로 남겨 두고 리포트에서 따로 볼 수 있다 (운영자 결정).
     다섯 개 단위에 묶이지 않는다 — 이 묶음이 떨어지면 다음 묶음을 그 날에 배정한다. */
  function skipDaily(pid) {
    markDailySkipped(pid, function () { moreDaily(pid); });
  }

  function markDailySkipped(pid, done) {
    if (!window.Store || !Store.available() || !dailyProgress) { done(); return; }
    if (dailyProgress.sentences[dailyAt]) { done(); return; }   // 이미 한 것은 건드리지 않는다
    dailyProgress.sentences[dailyAt] = 'skip';
    dailyProgress.at = dailyAt;
    Store.saveProgress(dailyProgress, noteStorage);
    setTimeout(done, 60);
  }

  function moreDaily(pid) {
    var next = nextUnseen(dailyAt);
    if (next >= 0) { dailyGo(pid, next); return; }

    // 이 묶음을 다 봤다. 안 쓴 것이 있으면 그 날에 하나 더 배정한다
    var fresh = dailyKind === 'shows' ? unusedShow() : unusedSet();
    if (fresh && dailyDate) {
      assignSet(pid, dailyDate, fresh, function () {
        if (dailyKind === 'shows') openShow(pid, fresh, dailyDate, 0);
        else openSet(pid, fresh, dailyDate, 0);
        setTimeout(function () { dailySay('Next set.'); }, 200);
      });
      return;
    }
    noMoreSets(pid, dailyDate);
  }

  function revealDaily(pid) {
    if (dailyShown) return;
    dailyShown = true;
    markDailyDone(pid);
    drawDaily(pid);
    dailySay('Compare it with what you said, then say it once more out loud.');
  }

  /* 채점을 하지 않으므로 맞고 틀림은 남기지 않는다. 했다는 것만 남긴다 —
     연속 학습 일수와 학습량 그래프의 재료다 (SPEC 4-3). */
  function markDailyDone(pid) {
    if (!window.Store || !Store.available() || !dailyProgress) return;
    if (dailyProgress.sentences[dailyAt]) return;   // 같은 문장을 두 번 세지 않는다
    dailyProgress.at = dailyAt;
    dailyProgress.sentences[dailyAt] = 'ok';
    Store.saveProgress(dailyProgress, noteStorage);
    Store.bumpDay(pid, noteStorage);
  }

  function saveDailyCard(pid) {
    if (!dailyDay) return;
    if (!window.Store || !Store.available()) {
      dailySay('This browser will not let the app save cards.');
      return;
    }
    var vid = dailyDay.videoId, at = dailyAt;
    Store.addCard(pid, vid, at, 'daily', function () { dailySay('Could not save the card.'); });
    // 정말 들어갔는지 확인하고 말한다. 넣기만 하고 끝내면 실패를 모른다
    setTimeout(function () {
      Store.listCards(pid, function (list) {
        var key = pid + '|' + vid + '|' + at;
        for (var i = 0; i < list.length; i++) {
          if (list[i].key === key) {
            var b = $('daily-save');
            if (b) { b.className = 'half on'; b.textContent = 'Saved'; }
            dailySay('Saved to cards — ' + list.length + ' saved. Open Cards from the library.');
            return;
          }
        }
        dailySay('Could not save the card.');
      }, function () { dailySay('Saved, but could not read the card list back.'); });
    }, 150);
  }

  /* 녹음이 빈손으로 돌아왔을 때 왜 그런지 사람 말로 적는다 (SPEC 9) */
  function recordNote(note) {
    if (note === 'mic-taken') {
      return 'This phone gives the microphone to one thing at a time, and speech-to-text took it. '
        + 'Writing down what you say is off now — press Record again and the sound will be kept.';
    }
    if (note === 'too-short') {
      return 'That was too short to keep. Press Record, say the sentence, then press Stop.';
    }
    return 'Nothing was recorded. Check that the microphone is allowed, then try again.';
  }

  function toggleDailyRecord(pid) {
    if (dailyRecording) {
      dailyRecording = false;
      // 단추는 답을 기다리지 않고 **바로** 되돌린다. 기다렸다가 답이 안 오면
      // 'Stop' 인 채로 굳어서 눌러도 아무 일이 없는 것처럼 보인다 — 실제로 겪었다
      var stopBtn = $('daily-rec');
      if (stopBtn) { stopBtn.className = 'half'; stopBtn.textContent = 'Record'; }
      dailySay('Saving what you said\u2026');
      Recorder.stop(function (url, heard, note) {
        var au = $('daily-audio'), mb = $('daily-mine');
        if (url && au) { au.src = url; if (mb) mb.disabled = false; }
        if (heard) {
          dailyHeard = heard;
          var hb = $('daily-heard');
          if (hb) { clear(hb); hb.appendChild(document.createTextNode('You said: ' + heard)); }
        }
        if (!url) { dailySay(recordNote(note)); return; }
        if (heard) dailySay('Now write it down, or press Show answer and compare.');
        else if (!Recorder.canTranscribe()) {
          dailySay('Recorded. Play it back, then compare it with the answer.');
        } else {
          dailySay('Recorded, but nothing was picked up. Play it back, or record again.');
        }
      });
      return;
    }
    Recorder.start(function () {
      dailyRecording = true;
      var b = $('daily-rec');
      if (b) { b.className = 'half rec-on'; b.textContent = 'Stop'; }
      dailySay('Recording. Say the English sentence, then press Stop.');
    }, function (why) {
      if (why === 'denied') dailySay('Microphone permission was refused, so recording is off.');
      else dailySay('Could not start recording. Say it out loud anyway, then press Show answer.');
    });
  }

  /* ---------------------------------------------------------------- 설정 — AI 열쇠 (ROADMAP 2단계)

     열쇠는 **기기에 하나**다. 프로필별이 아니다 — 사람마다 발급받게 하면 감당이 안 된다.
     저장소에도 백업에도 안 올라간다. 백업 파일은 사람이 주고받는 물건이라서다.

     **저장하기 전에 실제로 한 번 불러 본다.** 안 되는 열쇠를 넣어 두면 대화 도중에야
     알게 되고, 그때는 무엇이 잘못됐는지 알기가 더 어렵다. */

  /* 대화 연습 화면은 talkui.js 가 그린다 — app.js 는 이미 크고, 그쪽은 통째로 새 기능이다.
     여기서는 화면 옮기기와 폰 목소리만 넘겨 준다. */
  function openTalk(profileId) {
    setProfileId(profileId);
    if (!window.TalkUI) { show('library'); return; }
    TalkUI.attach({ go: go, show: show, speak: function (t) { if (canSpeak()) speakText(t); } });
    TalkUI.open(profileId);
  }

  var KEY_NAME = 'aiKey';
  var KEY_COMPANY = 'aiCompany';

  function showSettings(pid) {
    setProfileId(pid);
    show('settings');

    var sel = $('key-company');
    if (!sel.options.length && window.Talk) {
      var list = Talk.companies();
      for (var i = 0; i < list.length; i++) {
        var o = document.createElement('option');
        o.value = list[i].id;
        o.appendChild(document.createTextNode(list[i].name));
        sel.appendChild(o);
      }
    }

    $('key-input').value = '';
    keyMsg('');

    if (!window.Store || !Store.available()) {
      keyState('This browser will not let the app remember a key, so talk practice cannot run here.', true);
      return;
    }
    Store.getSetting(KEY_COMPANY, function (saved) {
      if (saved && sel.querySelector('option[value="' + saved + '"]')) sel.value = saved;
      drawKeyHint();
      Store.getSetting(KEY_NAME, function (key) {
        if (key) keyState('A key is saved on this device. Everyone using this phone shares it.');
        else keyState('No key yet. Talk practice stays off until one is saved.');
      }, function () { keyState('Could not read the saved key.', true); });
    }, function () { keyState('Could not read the saved key.', true); });
  }

  function drawKeyHint() {
    var c = window.Talk && Talk.company($('key-company').value);
    $('key-hint').textContent = c ? c.keyHint : '';
  }

  function keyState(text, bad) {
    var n = $('key-state');
    n.className = 'notice' + (bad ? ' error' : '');
    n.textContent = text;
  }

  function keyMsg(text, bad) {
    var n = $('key-msg');
    clear(n);
    if (!text) return;
    n.appendChild(el('div', 'notice' + (bad ? ' error' : ''), text));
  }

  /* 실패한 까닭을 사람 말로 바꾼다. 조용히 실패하지 않는다 (SPEC 9) */
  function keyReasonText(reason) {
    if (reason === 'key') return 'That key was refused. Check you copied all of it.';
    if (reason === 'limit') return 'The key works, but the account is out of credit or over its limit.';
    if (reason === 'offline') return 'Could not reach the company. Check the connection and try again.';
    if (reason === 'timeout') return 'No answer within ' + Math.round(Talk.TIMEOUT_MS / 1000)
      + ' seconds. Try again.';
    if (reason === 'company') return 'The company is having trouble right now. Try again later.';
    return 'Could not check the key.';
  }

  function saveKey() {
    var companyId = $('key-company').value;
    var key = String($('key-input').value || '').replace(/^\s+|\s+$/g, '');
    if (!key) { keyMsg('Paste the key first.', true); return; }
    if (!window.Talk) { keyMsg('Talk practice is not loaded on this page.', true); return; }

    $('key-save').disabled = true;
    keyMsg('Checking the key with the company\u2026');

    Talk.checkKey(companyId, key, function () {
      Store.saveSetting(KEY_COMPANY, companyId, function () {
        Store.saveSetting(KEY_NAME, key, function () {
          $('key-save').disabled = false;
          $('key-input').value = '';
          keyMsg('The key works and is saved on this device.');
          keyState('A key is saved on this device. Everyone using this phone shares it.');
        }, function () { $('key-save').disabled = false; keyMsg('Could not save the key.', true); });
      }, function () { $('key-save').disabled = false; keyMsg('Could not save the key.', true); });
    }, function (reason) {
      // 안 되는 열쇠는 저장하지 않는다
      $('key-save').disabled = false;
      keyMsg(keyReasonText(reason), true);
    });
  }

  function clearKey() {
    if (!window.Store || !Store.available()) return;
    Store.clearSetting(KEY_NAME, function () {
      keyMsg('The key is gone from this device.');
      keyState('No key yet. Talk practice stays off until one is saved.');
    }, function () { keyMsg('Could not remove the key.', true); });
  }

  /* ---------------------------------------------------------------- 1단계 판정 셈 (ROADMAP)
     운영자가 주마다 리뷰한다. 기록에서 **셀 수 있는 셋**만 센다 —
     나머지 둘(대사가 맥락 없이 쓸 만한가, 챗보다 나은가)은 사람이 보고 판단하는 것이라
     화면에 적어만 두고 세지 않는다.

     주는 오늘부터 거꾸로 7일씩 끊는다. 달력 주(월~일)로 끊으면 화요일에는
     "4일 이상"이 아직 될 수가 없어서 매번 미달로 보인다.

     아직 시작도 안 한 주를 미달로 세면 안 된다. 첫 기록보다 앞선 주는 'na' 로 둔다 —
     안 그러면 첫 주에 바로 "멈춰라"가 뜬다. */
  var GATE_WEEKS = 4;        // 몇 주를 보나. 넘어가려면 이만큼 연속 통과
  var GATE_OPEN_DAYS = 4;    // 그 주에 Daily 를 연 날
  var GATE_SKIP_MAX = 0.3;   // 건너뛴 비율 상한
  var GATE_CARDS = 3;        // 그 주에 담은 문장카드

  function gateRange(base, w) {
    var end = new Date(base.getTime());
    end.setDate(end.getDate() - 7 * w);
    var start = new Date(end.getTime());
    start.setDate(start.getDate() - 6);
    return { from: dateStr(start), to: dateStr(end) };
  }

  /* 기록이 처음 생긴 날. 이보다 앞선 주는 판정하지 않는다 */
  function gateFirstDate(all) {
    var best = null;
    function see(d) { if (d && (!best || d < best)) best = d; }
    var lists = [all.plan || [], all.cards || [], all.days || []];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) see(lists[i][j].date);
    }
    return best;
  }

  /* 한 주의 숫자. all 은 Store.exportAll 이 준 것 */
  function gateWeek(all, from, to) {
    // 1) Daily 를 연 날 — 묶음이 배정된 날이 그 날이다
    var openDays = 0, used = {};
    var plan = all.plan || [];
    for (var i = 0; i < plan.length; i++) {
      var p = plan[i];
      if (!p.date || p.date < from || p.date > to) continue;
      var ids = (p.setIds || []).concat(p.showIds || []);
      if (!ids.length) continue;
      openDays++;
      for (var j = 0; j < ids.length; j++) used[ids[j]] = true;
    }

    // 2) 건너뛴 비율 — 문장마다 날짜가 없으므로 **그 주에 배정된 묶음**으로 센다
    var seen = 0, skipped = 0;
    var prog = all.progress || [];
    for (var k = 0; k < prog.length; k++) {
      var vid = String(prog[k].videoId || '');
      if (vid.indexOf('daily-') !== 0 && vid.indexOf('shows-') !== 0) continue;
      if (!used[vid.slice(6)]) continue;
      var st = prog[k].sentences || {};
      for (var q in st) {
        if (!st.hasOwnProperty(q)) continue;
        seen++;
        if (st[q] === 'skip') skipped++;
      }
    }

    // 3) 그 주에 담은 문장카드
    var cards = 0;
    var cs = all.cards || [];
    for (var c = 0; c < cs.length; c++) {
      var d = cs[c].date;
      if (d && d >= from && d <= to) cards++;
    }

    return { from: from, to: to, openDays: openDays, seen: seen, skipped: skipped,
             skipRate: seen ? skipped / seen : 0, cards: cards, na: false };
  }

  function gateWeeks(all, base) {
    var first = gateFirstDate(all);
    var out = [];
    for (var w = 0; w < GATE_WEEKS; w++) {
      var r = gateRange(base, w);
      var one = gateWeek(all, r.from, r.to);
      one.na = !first || r.to < first;      // 시작 전이라 판정할 것이 없는 주
      out.push(one);
    }
    return out;
  }

  /* 아무것도 안 한 주는 건너뛴 비율이 0 이라 그냥 두면 통과로 보인다. seen 을 같이 본다 */
  function gateChecks(w) {
    return {
      days: w.openDays >= GATE_OPEN_DAYS,
      skip: w.seen > 0 && w.skipRate < GATE_SKIP_MAX,
      cards: w.cards >= GATE_CARDS
    };
  }

  function gatePassed(w) {
    var c = gateChecks(w);
    return c.days && c.skip && c.cards;
  }

  /* 넘어가는 조건과 멈추는 조건. weeks[0] 이 최근 주다 */
  function gateVerdict(weeks) {
    var streak = 0, low = 0, judged = 0;
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].na || !gatePassed(weeks[i])) break;
      streak++;
    }
    for (var j = 0; j < weeks.length; j++) {
      if (weeks[j].na) continue;
      judged++;
      var c = gateChecks(weeks[j]);
      var n = (c.days ? 1 : 0) + (c.skip ? 1 : 0) + (c.cards ? 1 : 0);
      if (n < 2) low++;                     // 절반을 못 채운 주
    }
    return { streak: streak, ready: streak >= GATE_WEEKS,
             judged: judged, low: low, stop: low >= 2 };
  }
  /* -------------------------------------------------------------- 1단계 판정 셈 끝 */

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
    drawRecordBlocks(box, pid);

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
  /* 건너뛴 문장을 모아 보여 준다. 건너뛴 것은 없어지는 게 아니라 미뤄 둔 것이다 */
  /* 기록 전체를 한 번만 읽어 판정표와 건너뛴 목록을 같이 그린다.
     자리를 먼저 잡아 두어야 늦게 채워도 차례가 안 흐트러진다 */
  function drawRecordBlocks(box, pid) {
    if (!window.Store || !Store.available()) return;
    var gateSlot = el('div', null);
    var skipSlot = el('div', null);
    box.appendChild(gateSlot);
    box.appendChild(skipSlot);
    Store.exportAll(pid, function (all) {
      fillGate(gateSlot, all);
      fillSkipped(skipSlot, pid, all);
    }, function () {});
  }

  /* 1단계 판정표 — ROADMAP "매주 보는 것". 셈은 위 gate* 함수들이 한다 */
  function fillGate(slot, all) {
    // 기록이 아예 없으면 그리지 않는다. 갓 깐 기기에서 "not started yet" 네 줄은 군더더기다
    if (!gateFirstDate(all)) return;
    var weeks = gateWeeks(all, new Date());
    var v = gateVerdict(weeks);

    var box = el('div', 'notice');
    box.appendChild(el('div', 'chartlabel', 'Weekly check \u2014 ready for step 2?'));

    var t = el('table', 'gate');
    var tb = el('tbody', null);
    t.appendChild(tb);
    var head = el('tr');
    head.appendChild(el('th', null, ''));
    head.appendChild(el('th', null, 'Days'));
    head.appendChild(el('th', null, 'Skipped'));
    head.appendChild(el('th', null, 'Cards'));
    tb.appendChild(head);

    for (var i = 0; i < weeks.length; i++) {
      var w = weeks[i];
      var tr = el('tr', w.na ? 'na' : (gatePassed(w) ? 'pass' : null));
      tr.appendChild(el('td', 'wk', i === 0 ? 'This week' : (i + ' wk ago')));
      if (w.na) {
        var none = el('td', 'none', 'not started yet');
        none.colSpan = 3;
        tr.appendChild(none);
      } else {
        var c = gateChecks(w);
        tr.appendChild(gateCell(String(w.openDays), c.days));
        tr.appendChild(gateCell(w.seen ? (Math.round(w.skipRate * 100) + '%') : '\u2014', c.skip));
        tr.appendChild(gateCell(String(w.cards), c.cards));
      }
      tb.appendChild(tr);
    }
    box.appendChild(t);

    box.appendChild(el('div', 'gatefoot', 'A week passes with ' + GATE_OPEN_DAYS
      + '+ days opened, under ' + Math.round(GATE_SKIP_MAX * 100) + '% skipped, and '
      + GATE_CARDS + '+ cards saved.'));

    var msg;
    if (v.ready) msg = 'Passed ' + v.streak + ' weeks in a row \u2014 ready for step 2.';
    else if (v.streak) msg = 'Passed ' + v.streak + (v.streak === 1 ? ' week' : ' weeks')
      + ' in a row. Need ' + GATE_WEEKS + '.';
    else msg = 'No passing week yet. Need ' + GATE_WEEKS + ' in a row.';
    box.appendChild(el('div', 'gateline' + (v.ready ? ' ok' : ''), msg));

    if (v.stop) {
      box.appendChild(el('div', 'gateline no', v.low + ' of the last ' + v.judged
        + ' weeks came in under half. Worth fixing the sentences before paying for step 2.'));
    }

    box.appendChild(el('div', 'gatefoot',
      'Two more to judge by eye: are the show lines usable out of context (1 in 5 or fewer bad), '
      + 'and is this better than doing it in chat?'));

    slot.appendChild(box);
  }

  function gateCell(text, ok) {
    return el('td', ok ? 'ok' : 'no', text + (ok ? ' \u2713' : ' \u2717'));
  }

  function fillSkipped(slot, pid, all) {
    (function () {
      var rows = [];
      for (var i = 0; i < all.progress.length; i++) {
        var pr = all.progress[i];
        if (!pr.sentences) continue;
        for (var k in pr.sentences) {
          if (pr.sentences[k] === 'skip') rows.push({ videoId: pr.videoId, i: parseInt(k, 10) });
        }
      }
      if (!rows.length) return;
      slot.appendChild(el('div', 'count', 'Skipped \u2014 ' + rows.length));
      var ul = el('ul', 'list');
      for (var r = 0; r < rows.length && r < 20; r++) {
        (function (one) {
          var b = el('button', 'item');
          var body = el('div', 'body');
          body.appendChild(el('div', 'name', 'Go back to it'));
          body.appendChild(el('div', 'meta', String(one.videoId).replace(/^daily-/, 'Set ')
            .replace(/^shows-/, 'Shows ') + ' \u00b7 #' + (one.i + 1)));
          b.appendChild(body);
          b.onclick = function () {
            var v = String(one.videoId);
            if (v.indexOf('daily-s') === 0 || v.indexOf('shows-') === 0) {
              go('#/' + pid + '/' + routeOfKind(kindOfId(v)) + '/' + v.slice(6) + '/' + one.i);
            } else {
              go('#/' + pid + '/' + v + '/' + one.i);
            }
          };
          var li = document.createElement('li');
          li.appendChild(b);
          ul.appendChild(li);
        })(rows[r]);
      }
      slot.appendChild(ul);
    })();
  }

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
    var done = 0;
    for (var k in progress.sentences) {
      if (!progress.sentences.hasOwnProperty(k)) continue;
      if (posAt[k] === undefined) continue;   // 감춘 줄에 남은 옛 기록은 세지 않는다
      done++;
    }
    var el2 = $('done-count');
    if (el2) {
      el2.textContent = playable.length ? (done + ' of ' + playable.length + ' practised') : '';
    }
    for (var i = 0; i < playable.length; i++) {
      var at = playable[i];
      var b = $('sentence-' + at);
      if (!b) continue;
      b.setAttribute('data-done', progress.sentences[at] || '');
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
      // null 은 채점 대상이 아닌 조각이다. 빨갛게 칠하지 않는다
      var w = el('span', (r.ok[i] === null || r.ok[i]) ? 'w' : 'w bad', r.words[i]);
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
     틀렸다고 자동으로 담지 않는다. 담을 문장은 사람이 고른다 (운영자 결정). */
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
    say('Saving what you said\u2026');
    Recorder.stop(function (url, heard, note) {
      if (url) {
        $('mine').src = url;
        $('mine-btn').disabled = false;
      }
      showHeard(heard);
      say(url ? 'Recorded. Play it back, or record again.' : recordNote(note));
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
    var said = false;
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
        // 되풀이는 멈췄다 다시 트는 게 아니라 자리만 되돌린다. 멈추면 유튜브가
        // 영상 위에 공유 단추를 띄우고, 가림막이 깜빡이면서 흐름이 끊긴다.
        if (repeat && loopFrom !== null) {
          startedAt = (new Date()).getTime();   // 자리를 옮기는 동안의 멈춤을 무시하게
          armed = false;
          waited = 0;
          player.seekTo(loopFrom, true);
          player.playVideo();
          if (!said) { said = true; say('Repeating. Press Repeat again to stop after this round.'); }
          return;
        }
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
    loopFrom = from;
    startedAt = (new Date()).getTime();

    // 순서가 중요하다. 모바일 사파리는 화면을 누른 그 흐름에서 재생을 시작해야 받아 준다.
    // 자리를 먼저 옮기면 재생 명령이 씹혀서 "위치만 가고 안 들리는" 상태가 된다.
    player.playVideo();
    player.seekTo(from, true);
    player.setPlaybackRate(slow ? 0.75 : 1);

    startWatch(s.end + TAIL);
    nudge(0);
    var pos = posAt[current];
    say('Playing sentence ' + ((pos === undefined ? current : pos) + 1)
      + (slow ? ' at 0.75\u00d7' : '') + (repeat ? ' \u00b7 repeating' : ''));
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

  /* 그 문장만 계속 되풀이한다. 귀에 붙을 때까지 듣는 연습이다 */
  function toggleRepeat() {
    repeat = !repeat;
    var b = $('repeat-btn');
    b.className = repeat ? 'half on' : 'half';
    b.textContent = repeat ? 'Repeat on' : 'Repeat';
    say(repeat
      ? 'Repeat on. Press Play and the sentence goes round and round until you turn this off.'
      : 'Repeat off. It stops at the end of this round.');
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
      if (checked) stepSentence(1);
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
    if (clipWant) { var c = clipWant; clipWant = null; clipEnsure(c); }
  };

  /* 데스크탑·폰에 앱으로 설치할 수 있게 한다.
     캐시는 인터넷이 안 될 때만 쓰는 network-first 라서 옛 코드가 남는 덫은 없다 (sw.js 참고).
     안 되는 기기에서는 조용히 넘어간다 — 설치가 안 될 뿐 연습은 그대로 된다. */
  function registerWorker() {
    if (!navigator.serviceWorker) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;
    try {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    } catch (e) { /* 설치만 못 할 뿐이다 */ }
  }

  function boot() {
    setControls(false);
    $('play-btn').onclick = playCurrent;
    $('replay-btn').onclick = playCurrent;
    $('slow-btn').onclick = toggleSlow;
    $('repeat-btn').onclick = toggleRepeat;
    $('clip-repeat').onclick = toggleClipRepeat;
    $('prev-btn').onclick = function () { stepSentence(-1); };
    $('next-btn').onclick = function () { stepSentence(1); };
    $('change-profile').onclick = function () { go('#/'); };
    $('report-btn').onclick = function () { go('#/' + profileId + '/report'); };
    $('report-back').onclick = function () { go('#/' + profileId); };
    $('settings-btn').onclick = function () { go('#/' + profileId + '/settings'); };
    $('talk-btn').onclick = function () { go('#/' + profileId + '/talk'); };
    $('talk-back').onclick = function () { go('#/' + profileId); };
    $('settings-back').onclick = function () { go('#/' + profileId); };
    $('key-company').onchange = function () { drawKeyHint(); };
    $('key-save').onclick = function () { saveKey(); };
    $('key-clear').onclick = function () { clearKey(); };
    $('cards-btn').onclick = function () { go('#/' + profileId + '/cards'); };
    $('cards-back').onclick = function () { go('#/' + profileId); };
    $('daily-btn').onclick = function () { go('#/' + profileId + '/daily'); };
    $('daily-back').onclick = function () { go('#/' + profileId); };
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
    registerWorker();

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
