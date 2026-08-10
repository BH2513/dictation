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
  var videos = [];
  var video = null;
  var current = -1;
  var slow = false;
  var strict = false;       // SPEC 6: 기본은 관대 모드
  var audioOnly = false;    // 화면을 덮고 소리만 듣는다
  var checked = false;
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
    var all = ['profiles', 'library', 'listen'];
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
    showListen(profileId, videoId);
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

  function showListen(profileId, videoId) {
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
      if (video.sentences && video.sentences.length) select(0, false);
      else say('This video has no sentences.');
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


  /* ---------------------------------------------------------------- 받아쓰기 */

  function sentenceAt(idx) {
    var list = (video && video.sentences) || [];
    return (idx >= 0 && idx < list.length) ? list[idx] : null;
  }

  function resetAnswer() {
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

  function toggleStrict() {
    strict = !strict;
    $('strict-btn').className = strict ? 'small on' : 'small';
    $('strict-btn').textContent = strict ? 'Strict' : 'Lenient';
    say(strict
      ? 'Strict: capitals and punctuation must match.'
      : 'Lenient: capitals, punctuation and contractions are forgiven.');
    if (checked) checkAnswer();
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
    $('list-btn').onclick = function () { toggleList(); };
    $('cover').onclick = playCurrent;
    $('check-btn').onclick = checkAnswer;
    $('hint-btn').onclick = nextHint;
    $('reveal-btn').onclick = revealAnswer;
    $('strict-btn').onclick = toggleStrict;
    $('audio-btn').onclick = toggleAudioOnly;
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
