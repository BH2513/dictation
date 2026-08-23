/* 사람마다 고르는 것 — 글자 크기, 색, 대화를 어떻게 굴릴지 (SPEC 10-d).

   **프로필별이다.** 같은 기기를 가족이 나눠 쓰고 취향이 다르다.
   AI 열쇠(`store.js` 의 `settings`)만 기기별이고, 그건 다른 것이다 — 헷갈리면 안 된다.

   **기본값은 여기 한 곳에만 둔다.** 화면마다 기본값을 적어 두면 어느 하나가 어긋난다.

   **고른 것은 곧바로 화면에 먹여야 한다** — 설정에서 글자를 키웠는데 그 화면만 그대로면
   고쳐진 것인지 아닌지를 알 수가 없다. 그래서 `apply()` 가 `<html>` 에 표시를 붙이고,
   `style.css` 가 그 표시를 보고 값을 바꾼다.

   fetch 와 Promise 를 쓰지 않는다 — 구형 iOS 사파리에서 그대로 돌아야 한다. */
window.Prefs = (function () {

  /* 기본값. **여기가 유일한 자리다.** */
  var DEFAULTS = {
    theme: 'dark',        // dark | light
    textSize: 'normal',   // normal | large | larger
    turnTaking: 'manual', // manual | auto — 아래 설명
    waitSec: 2.5,         // auto 일 때 이만큼 조용하면 보낸다
    voice: ''             // 답을 읽어 줄 목소리. 빈 값이면 폰이 고른 대로
  };

  /* 고를 수 있는 것. 설정 화면이 이걸 보고 그린다 —
     화면에 목록을 또 적으면 여기와 어긋난다. */
  var CHOICES = {
    theme: [
      { value: 'dark', name: 'Dark', desc: 'Easier at night.' },
      { value: 'light', name: 'Light', desc: 'Easier to read in daylight.' }
    ],
    textSize: [
      { value: 'normal', name: 'Normal', desc: '' },
      { value: 'large', name: 'Large', desc: '' },
      { value: 'larger', name: 'Largest', desc: '' }
    ],
    turnTaking: [
      { value: 'manual', name: 'I tap when I am done',
        desc: 'Nothing is sent until you tap. Tap again to start talking.' },
      { value: 'auto', name: 'Send when I stop talking',
        desc: 'It sends on its own after a pause, then listens again.' }
    ]
  };

  var WAIT_MIN = 1.5, WAIT_MAX = 8;

  /* **마이크와 스피커는 브라우저에서 못 고른다** (2026-08-26 확인).
     음성인식(Web Speech)은 어느 마이크를 쓸지 고르는 길이 없고, 소리를 어느 스피커로
     낼지 고르는 것(`setSinkId`)은 아이폰 사파리에 아예 없다. 그건 폰 쪽에서 바꿔야 한다.

     **고를 수 있는 것은 목소리다.** 폰에 들어 있는 영어 목소리 중에서 고른다 —
     남자·여자, 미국·영국·호주가 갈린다. 그것만으로도 느낌이 꽤 달라진다. */
  function voices() {
    if (!window.speechSynthesis || !window.speechSynthesis.getVoices) return [];
    var all = [];
    try { all = window.speechSynthesis.getVoices() || []; } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var v = all[i];
      if (!v || !v.lang) continue;
      if (String(v.lang).toLowerCase().indexOf('en') !== 0) continue;   // 영어만
      out.push({ value: v.name, name: v.name, desc: v.lang });
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return out;
  }

  /* 고른 목소리를 실제 목소리로 바꿔 준다. 없어졌으면 폰이 고른 대로 둔다 */
  function voiceFor(name) {
    if (!name || !window.speechSynthesis || !window.speechSynthesis.getVoices) return null;
    var all = [];
    try { all = window.speechSynthesis.getVoices() || []; } catch (e) { return null; }
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].name === name) return all[i];
    return null;
  }

  var current = clone(DEFAULTS);
  var loadedFor = '';

  function clone(o) {
    var out = {};
    for (var k in o) if (o.hasOwnProperty(k)) out[k] = o[k];
    return out;
  }

  /* 모르는 값이 들어와도 기본값으로 되돌린다 — 옛 백업을 불러올 수 있다 */
  function clean(raw) {
    var out = clone(DEFAULTS);
    if (!raw) return out;
    for (var k in DEFAULTS) {
      if (!DEFAULTS.hasOwnProperty(k) || !raw.hasOwnProperty(k)) continue;
      var v = raw[k];
      if (k === 'waitSec') {
        v = parseFloat(v);
        if (!(v >= WAIT_MIN && v <= WAIT_MAX)) continue;
        out[k] = Math.round(v * 10) / 10;
        continue;
      }
      if (k === 'voice') { if (typeof v === 'string') out[k] = v; continue; }
      var ok = CHOICES[k];
      if (!ok) continue;
      for (var i = 0; i < ok.length; i++) if (ok[i].value === v) { out[k] = v; break; }
    }
    return out;
  }

  /* 고른 것을 화면에 먹인다. `<html>` 에 표시를 붙이면 style.css 가 알아서 바꾼다 */
  function apply() {
    var el = document.documentElement;
    if (!el) return;
    el.setAttribute('data-theme', current.theme);
    el.setAttribute('data-text', current.textSize);
  }

  return {
    DEFAULTS: DEFAULTS,
    CHOICES: CHOICES,
    WAIT_MIN: WAIT_MIN,
    WAIT_MAX: WAIT_MAX,
    clean: clean,

    /* 지금 값. 아직 안 읽었으면 기본값이다 — 화면이 멈추지 않게 */
    get: function () { return current; },

    /* 프로필이 바뀌면 다시 읽는다. 저장을 못 쓰는 기기에서는 기본값으로 간다 */
    load: function (profileId, done) {
      done = done || function () {};
      if (!profileId) { current = clone(DEFAULTS); apply(); done(current); return; }
      if (loadedFor === profileId) { apply(); done(current); return; }
      if (!window.Store || !Store.available()) { current = clone(DEFAULTS); apply(); done(current); return; }
      Store.getPrefs(profileId, function (raw) {
        current = clean(raw);
        loadedFor = profileId;
        apply();
        done(current);
      }, function () { current = clone(DEFAULTS); apply(); done(current); });
    },

    /* 하나만 바꾼다. **바꾸는 즉시 화면에 먹인다** */
    set: function (profileId, name, value, done) {
      done = done || function () {};
      var next = clone(current);
      next[name] = value;
      current = clean(next);
      apply();
      if (!window.Store || !Store.available()) { done(current); return; }
      Store.savePrefs(profileId, current, function () { done(current); },
                      function () { done(current); });
    },

    /* 대화 화면이 쓰는 값 */
    waitMs: function () { return Math.round(current.waitSec * 1000); },
    handsFree: function () { return current.turnTaking === 'auto'; },
    voices: voices,
    voice: function () { return voiceFor(current.voice); }
  };
})();
