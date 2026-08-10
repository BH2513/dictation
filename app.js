/* 받아쓰기 연습 — 프로필 선택 / 라이브러리 / 듣기.
   빌드 단계가 없으므로 구형 사파리에서 그대로 돌아가야 한다. var 와 함수 선언으로 쓴다. */
(function () {
  // SPEC 4-1: 시작점 여유. 자동자막은 문장 시작을 늦게 잡을 때가 있어 조절할 수 있어야 한다
  var LEADS = [0.3, 0.6, 1.0, 1.5];
  var leadAt = 1;           // 기본 0.6초
  var TAIL = 0.3;           // 끝 여유. 마지막 단어가 잘리지 않게 (초)
  var TICK_MS = 40;         // 끝 지점 감시 주기
  var STOP_MARGIN = 0.04;   // 감시 주기로 인한 정지 지연 보정

  var profiles = [];
  var profile = null;
  var videos = [];
  var video = null;
  var current = -1;
  var slow = false;

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
          fail('파일을 읽을 수 없습니다.');
          return;
        }
        ok(data);
      } else if (req.status === 404) {
        fail('없음');
      } else {
        fail('불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
      }
    };
    req.onerror = function () { fail('불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'); };
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
    notice(box, '불러오는 중…');

    getJSON('data/profiles.json', function (data) {
      profiles = data || [];
      clear(box);
      if (!profiles.length) {
        notice(box, '아직 등록된 사람이 없습니다.\nPC에서 영상을 등록하면 여기에 생깁니다.');
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
      notice(box, why === '없음'
        ? '아직 등록된 사람이 없습니다.\nPC에서 영상을 등록하면 여기에 생깁니다.'
        : '사람 목록을 ' + why, why !== '없음');
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
    notice(box, '불러오는 중…');

    findProfile(profileId, function (p) {
      profile = p;
      $('library-title').textContent = p ? p.name : '목록';

      getJSON('data/videos/' + profileId + '/index.json', function (data) {
        videos = data || [];
        clear(box);
        if (!videos.length) {
          notice(box, '아직 등록된 영상이 없습니다.\nPC에서 영상을 등록하면 여기에 생깁니다.');
          return;
        }
        var ul = el('ul', 'list');
        for (var i = 0; i < videos.length; i++) {
          (function (v) {
            var b = el('button', 'item');
            var body = el('div', 'body');
            body.appendChild(el('div', 'name', v.title || v.videoId));
            var meta = '문장 ' + (v.sentenceCount || 0) + '개';
            if (v.hasKorean) meta += ' · 한국어 있음';
            if (v.addedAt) meta += ' · ' + v.addedAt;
            body.appendChild(el('div', 'meta', meta));
            if (v.source === 'auto_captions') {
              body.appendChild(el('span', 'badge', '자동 자막 — 문장 경계가 부정확할 수 있음'));
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
        notice(box, why === '없음'
          ? '아직 등록된 영상이 없습니다.\nPC에서 영상을 등록하면 여기에 생깁니다.'
          : '영상 목록을 ' + why, why !== '없음');
      });
    });
  }

  /* ---------------------------------------------------------------- 듣기 */

  function showListen(profileId, videoId) {
    show('listen');
    current = -1;
    video = null;
    $('listen-title').textContent = '불러오는 중…';
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
      else say('이 영상에는 문장이 없습니다.');
    }, function (why) {
      notice($('sentence-list'), why === '없음'
        ? '이 영상의 문장 자료를 찾을 수 없습니다.'
        : '문장을 ' + why, true);
      $('listen-title').textContent = '불러오지 못했습니다';
    });
  }

  function toggleList(open) {
    var box = $('sentence-list');
    var on = (open === undefined) ? (box.style.display === 'none') : open;
    box.style.display = on ? 'block' : 'none';
    $('list-btn').textContent = on ? '문장 목록 닫기' : '문장 목록 (' + listLength() + '개)';
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
    $('list-btn').textContent = '문장 목록 (' + list.length + '개)';
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

    var s = list[idx];
    var box = $('now');
    clear(box);
    box.appendChild(document.createTextNode(s.text));
    if (s.ko) {
      var ko = el('span', 'ko', s.ko);
      box.appendChild(ko);
    }

    $('prev-btn').disabled = (idx === 0);
    $('next-btn').disabled = (idx === list.length - 1);

    if (play) playCurrent();
    else say('문장을 고르고 재생을 눌러 주세요.');
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
        say('들려드렸습니다. 다시 듣거나 다음 문장으로 넘어가세요.');
      }
    }, TICK_MS);
  }

  var loadTimer = null;

  function watchPlayerLoad() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (!playerReady) {
        say('영상 재생기를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.');
      }
    }, 8000);
  }

  function ensurePlayer(videoId) {
    watchPlayerLoad();
    if (!apiReady) { wantPlay = videoId; return; }
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
            // 자막이 켜져 있으면 답이 화면에 그대로 보인다
            try { player.unloadModule('captions'); player.unloadModule('cc'); } catch (e) {}
            if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
            setControls(true);
            say('준비됐습니다. 문장을 눌러 보세요.');
          },
          onStateChange: function (e) {
            if (e.data === YT.PlayerState.PLAYING) {
              setCover(false);
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
            say('영상을 재생할 수 없습니다. 유튜브에서 삭제되었거나 다른 곳에서 볼 수 없는 영상일 수 있습니다.');
          }
        }
      });
    }
  }

  function setCover(on) {
    var c = $('cover');
    if (c) c.className = on ? 'cover' : 'cover off';
  }

  function setControls(on) {
    $('play-btn').disabled = !on;
    $('replay-btn').disabled = !on;
    // 배속은 재생기가 없어도 미리 정해 둘 수 있다
  }

  function playCurrent() {
    var list = (video && video.sentences) || [];
    if (current < 0 || current >= list.length) return;
    if (!playerReady) { say('영상을 불러오는 중입니다. 잠시 뒤에 다시 눌러 주세요.'); return; }

    var s = list[current];
    var from = Math.max(0, s.start - LEADS[leadAt]);
    stopWatch();
    startedAt = (new Date()).getTime();

    // 순서가 중요하다. 모바일 사파리는 화면을 누른 그 흐름에서 재생을 시작해야 받아 준다.
    // 자리를 먼저 옮기면 재생 명령이 씹혀서 "위치만 가고 안 들리는" 상태가 된다.
    player.playVideo();
    player.seekTo(from, true);
    player.setPlaybackRate(slow ? 0.75 : 1);

    startWatch(s.end + TAIL);
    nudge(0);
    say('재생 중 — ' + (current + 1) + '번째 문장' + (slow ? ' (0.75배속)' : ''));
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

  function cycleLead() {
    leadAt = (leadAt + 1) % LEADS.length;
    showLead();
    say('앞 여유를 ' + LEADS[leadAt] + '초로 맞췄습니다. 다시 들어 보세요.');
  }

  function showLead() {
    $('lead-btn').textContent = '앞 여유 ' + LEADS[leadAt] + '초';
  }

  function toggleSlow() {
    slow = !slow;
    var b = $('slow-btn');
    b.className = slow ? 'on' : '';
    b.textContent = slow ? '0.75배속 켜짐' : '0.75배속';
    if (playerReady) player.setPlaybackRate(slow ? 0.75 : 1);
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
    $('lead-btn').onclick = cycleLead;
    showLead();

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
