/* 개인 기록 보관 — SPEC 4-2.
   IndexedDB 를 쓴다(localStorage 아님, 용량 때문). 열쇠에 프로필 ID 를 반드시 넣는다 —
   같은 기기를 가족 여러 명이 쓴다.

   실패해도 앱이 멈추면 안 된다. 사파리 사생활 보호 모드처럼 아예 못 쓰는 경우가 있어서,
   그때는 기록만 포기하고 연습은 그대로 되게 한다. 대신 화면에 그 사실을 남긴다. */
window.Store = (function () {
  var NAME = 'dictation';
  var VERSION = 2;
  var db = null;
  var broken = false;

  function noop() {}

  function open(done, fail) {
    done = done || noop;
    if (db) { done(db); return; }
    if (broken) { (fail || noop)('unavailable'); return; }
    if (!window.indexedDB) { broken = true; (fail || noop)('unavailable'); return; }

    var req;
    try { req = window.indexedDB.open(NAME, VERSION); }
    catch (e) { broken = true; (fail || noop)('unavailable'); return; }

    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      // 진도: 영상별 마지막 문장 위치와 문장별 결과
      if (!d.objectStoreNames.contains('progress')) {
        d.createObjectStore('progress', { keyPath: 'key' });
      }
      // 오답 기록: 틀린 낱말 하나가 한 줄
      if (!d.objectStoreNames.contains('misses')) {
        var m = d.createObjectStore('misses', { keyPath: 'id', autoIncrement: true });
        m.createIndex('profile', 'profileId', { unique: false });
        m.createIndex('profileWord', ['profileId', 'word'], { unique: false });
      }
      // 일별 학습량 — 연속 학습 일수와 그래프의 재료
      if (!d.objectStoreNames.contains('days')) {
        d.createObjectStore('days', { keyPath: 'key' });
      }
      // 문장카드
      if (!d.objectStoreNames.contains('cards')) {
        var c = d.createObjectStore('cards', { keyPath: 'key' });
        c.createIndex('profile', 'profileId', { unique: false });
      }
    };
    req.onsuccess = function () { db = req.result; done(db); };
    req.onerror = function () { broken = true; (fail || noop)('open-failed'); };
    req.onblocked = function () { broken = true; (fail || noop)('blocked'); };
  }

  function tx(store, mode, run, fail) {
    open(function (d) {
      var t;
      try { t = d.transaction(store, mode); }
      catch (e) { (fail || noop)('tx-failed'); return; }
      t.onerror = function () { (fail || noop)('tx-error'); };
      run(t.objectStore(store), t);
    }, fail);
  }

  function put(store, value, fail) {
    tx(store, 'readwrite', function (s) { s.put(value); }, fail);
  }

  function get(store, key, done, fail) {
    tx(store, 'readonly', function (s) {
      var r = s.get(key);
      r.onsuccess = function () { (done || noop)(r.result || null); };
      r.onerror = function () { (fail || noop)('get-failed'); };
    }, fail);
  }

  function allRows(store, done, fail) {
    tx(store, 'readonly', function (st) {
      var out = [];
      var cur = st.openCursor();
      cur.onsuccess = function (e) {
        var c = e.target.result;
        if (!c) { (done || noop)(out); return; }
        out.push(c.value);
        c.continue();
      };
      cur.onerror = function () { (fail || noop)('cursor-failed'); };
    }, fail);
  }

  function allByIndex(store, indexName, value, done, fail) {
    tx(store, 'readonly', function (s) {
      var out = [];
      var idx = s.index(indexName);
      var cur = idx.openCursor(window.IDBKeyRange.only(value));
      cur.onsuccess = function (e) {
        var c = e.target.result;
        if (!c) { (done || noop)(out); return; }
        out.push(c.value);
        c.continue();
      };
      cur.onerror = function () { (fail || noop)('cursor-failed'); };
    }, fail);
  }

  /* ---------------------------------------------------------------- 바깥에서 쓰는 것 */

  function progressKey(profileId, videoId) { return profileId + '|' + videoId; }

  return {
    available: function () { return !!window.indexedDB && !broken; },

    /* 영상 하나의 진도. sentences 는 {문장번호: 'ok'|'miss'} */
    getProgress: function (profileId, videoId, done, fail) {
      get('progress', progressKey(profileId, videoId), function (row) {
        done(row || { key: progressKey(profileId, videoId), profileId: profileId,
                      videoId: videoId, at: 0, sentences: {}, updatedAt: null });
      }, fail);
    },

    saveProgress: function (row, fail) {
      row.updatedAt = today();
      put('progress', row, fail);
    },

    /* 틀린 낱말 적재 — SPEC 6번 3단계 */
    addMisses: function (profileId, videoId, sentenceIndex, words, fail) {
      if (!words.length) return;
      tx('misses', 'readwrite', function (s) {
        for (var i = 0; i < words.length; i++) {
          s.put({
            profileId: profileId, videoId: videoId, i: sentenceIndex,
            word: String(words[i]).toLowerCase(), date: today()
          });
        }
      }, fail);
    },

    listMisses: function (profileId, done, fail) {
      allByIndex('misses', 'profile', profileId, done, fail);
    },

    /* 문장카드 — 같은 문장은 한 장만 */
    addCard: function (profileId, videoId, sentenceIndex, reason, fail) {
      put('cards', {
        key: profileId + '|' + videoId + '|' + sentenceIndex,
        profileId: profileId, videoId: videoId, i: sentenceIndex,
        reason: reason, date: today()
      }, fail);
    },

    listCards: function (profileId, done, fail) {
      allByIndex('cards', 'profile', profileId, done, fail);
    },

    /* 오늘 한 문장 수를 하나 올린다 */
    bumpDay: function (profileId, fail) {
      var key = profileId + '|' + today();
      tx('days', 'readwrite', function (st) {
        var r = st.get(key);
        r.onsuccess = function () {
          var row = r.result || { key: key, profileId: profileId, date: today(), count: 0 };
          row.count++;
          st.put(row);
        };
        r.onerror = function () { (fail || noop)('day-failed'); };
      }, fail);
    },

    listDays: function (profileId, done, fail) {
      tx('days', 'readonly', function (st) {
        var out = [];
        var cur = st.openCursor();
        cur.onsuccess = function (e) {
          var c = e.target.result;
          if (!c) { (done || noop)(out); return; }
          if (c.value.profileId === profileId) out.push(c.value);
          c.continue();
        };
        cur.onerror = function () { (fail || noop)('cursor-failed'); };
      }, fail);
    },

    today: today,

    /* 백업 — 프로필 하나의 기록을 전부 내놓는다 (SPEC 10) */
    exportAll: function (profileId, done, fail) {
      var out = { app: 'dictation', version: 1, profileId: profileId,
                  savedAt: today(), progress: [], misses: [], cards: [], days: [] };
      allRows('progress', function (rows) {
        for (var i = 0; i < rows.length; i++) if (rows[i].profileId === profileId) out.progress.push(rows[i]);
        allRows('misses', function (rows2) {
          for (var j = 0; j < rows2.length; j++) if (rows2[j].profileId === profileId) out.misses.push(rows2[j]);
          allRows('cards', function (rows3) {
            for (var k = 0; k < rows3.length; k++) if (rows3[k].profileId === profileId) out.cards.push(rows3[k]);
            allRows('days', function (rows4) {
              for (var m = 0; m < rows4.length; m++) if (rows4[m].profileId === profileId) out.days.push(rows4[m]);
              done(out);
            }, fail);
          }, fail);
        }, fail);
      }, fail);
    },

    /* 되살리기. 같은 열쇠는 덮어쓴다. 오답은 열쇠가 자동이라 그냥 더한다. */
    importAll: function (profileId, data, done, fail) {
      if (!data || data.app !== 'dictation') { (fail || noop)('not-ours'); return; }
      var jobs = [
        ['progress', data.progress || []],
        ['cards', data.cards || []],
        ['days', data.days || []]
      ];
      var left = jobs.length + 1;
      function step() { left--; if (left === 0) done(); }

      for (var j = 0; j < jobs.length; j++) {
        (function (name, rows) {
          tx(name, 'readwrite', function (st) {
            for (var i = 0; i < rows.length; i++) {
              var row = rows[i];
              row.profileId = profileId;
              row.key = String(row.key || '').replace(/^[^|]*\|/, profileId + '|');
              st.put(row);
            }
            step();
          }, fail);
        })(jobs[j][0], jobs[j][1]);
      }
      tx('misses', 'readwrite', function (st) {
        var rows = data.misses || [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          delete row.id;
          row.profileId = profileId;
          st.put(row);
        }
        step();
      }, fail);
    },

    progressKey: progressKey
  };

  function today() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }
})();
