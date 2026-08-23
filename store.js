/* 개인 기록 보관 — SPEC 4-2.
   IndexedDB 를 쓴다(localStorage 아님, 용량 때문). 열쇠에 프로필 ID 를 반드시 넣는다 —
   같은 기기를 가족 여러 명이 쓴다.

   실패해도 앱이 멈추면 안 된다. 사파리 사생활 보호 모드처럼 아예 못 쓰는 경우가 있어서,
   그때는 기록만 포기하고 연습은 그대로 되게 한다. 대신 화면에 그 사실을 남긴다. */
window.Store = (function () {
  var NAME = 'dictation';
  var VERSION = 5;
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
      // 공부한 날에 어떤 문장 묶음을 했는지. 묶음은 날짜에 묶여 있지 않다 —
      // 며칠 안 해도 버려지지 않게, 사람이 온 날에 하나씩 꺼내 쓴다 (SPEC 6-2)
      if (!d.objectStoreNames.contains('plan')) {
        var pl = d.createObjectStore('plan', { keyPath: 'key' });
        pl.createIndex('profile', 'profileId', { unique: false });
      }
      // 대화 연습 기록 (ROADMAP 2단계). **기기 안에만 둔다** — 개인 대화라
      // 저장소에 올리지 않는다. 백업(SPEC 10)에는 요약만 들어가고 대화 원문은 안 들어간다.
      if (!d.objectStoreNames.contains('talks')) {
        var tk = d.createObjectStore('talks', { keyPath: 'key' });
        tk.createIndex('profile', 'profileId', { unique: false });
      }
      // 기기 설정 — AI 열쇠 같은 것.
      // **여기만 프로필 ID 를 안 넣는다.** 열쇠는 기기에 하나를 넣고 온 가족이 같이 쓴다
      // (ROADMAP 2단계). 사람마다 발급받게 하면 감당이 안 된다.
      // 백업(SPEC 10)에는 넣지 않는다 — 백업 파일은 사람이 주고받는 물건이다.
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
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

    removeCard: function (profileId, videoId, sentenceIndex, done, fail) {
      tx('cards', 'readwrite', function (st) {
        st['delete'](profileId + '|' + videoId + '|' + sentenceIndex);
        (done || noop)();
      }, fail);
    },

    listCards: function (profileId, done, fail) {
      allByIndex('cards', 'profile', profileId, done, fail);
    },

    /* 공부한 날 ↔ 그날 한 묶음. 하루에 여러 묶음을 할 수 있다 */
    getPlan: function (profileId, date, done, fail) {
      get('plan', profileId + '|' + date, function (row) {
        row = row || { key: profileId + '|' + date, profileId: profileId, date: date };
        if (!row.setIds) row.setIds = [];      // 만든 문장 묶음
        if (!row.showIds) row.showIds = [];    // 영상 대사 묶음
        done(row);
      }, fail);
    },

    savePlan: function (row, done, fail) {
      put('plan', row, fail);
      if (done) setTimeout(done, 60);
    },

    listPlans: function (profileId, done, fail) {
      allByIndex('plan', 'profile', profileId, function (rows) {
        rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        done(rows);
      }, fail);
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

    /* 대화 연습 (ROADMAP 2단계). 번호는 절대 바뀌면 안 된다 — 문장카드가 가리킨다 */
    getTalk: function (profileId, id, done, fail) {
      get('talks', profileId + '|' + id, function (row) { done(row || null); }, fail);
    },

    saveTalk: function (row, done, fail) {
      put('talks', row, fail);
      if (done) setTimeout(done, 60);
    },

    listTalks: function (profileId, done, fail) {
      allByIndex('talks', 'profile', profileId, function (rows) {
        rows.sort(function (a, b) { return (a.id < b.id) ? 1 : -1; });
        done(rows);
      }, fail);
    },

    /* 기기 설정. 프로필별이 아니다 — 위 onupgradeneeded 의 설명을 볼 것 */
    getSetting: function (name, done, fail) {
      get('settings', name, function (row) { done(row ? row.value : null); }, fail);
    },

    saveSetting: function (name, value, done, fail) {
      put('settings', { key: name, value: value }, fail);
      if (done) setTimeout(done, 60);
    },

    clearSetting: function (name, done, fail) {
      tx('settings', 'readwrite', function (st) {
        st['delete'](name);
        if (done) setTimeout(done, 60);
      }, fail);
    },

    today: today,

    /* 백업 — 프로필 하나의 기록을 전부 내놓는다 (SPEC 10) */
    exportAll: function (profileId, done, fail) {
      var out = { app: 'dictation', version: 1, profileId: profileId,
                  savedAt: today(), progress: [], misses: [], cards: [], days: [], plan: [],
                  talkSummaries: [] };
      allRows('progress', function (rows) {
        for (var i = 0; i < rows.length; i++) if (rows[i].profileId === profileId) out.progress.push(rows[i]);
        allRows('misses', function (rows2) {
          for (var j = 0; j < rows2.length; j++) if (rows2[j].profileId === profileId) out.misses.push(rows2[j]);
          allRows('cards', function (rows3) {
            for (var k = 0; k < rows3.length; k++) if (rows3[k].profileId === profileId) out.cards.push(rows3[k]);
            allRows('days', function (rows4) {
              for (var m = 0; m < rows4.length; m++) if (rows4[m].profileId === profileId) out.days.push(rows4[m]);
              allRows('plan', function (rows5) {
                for (var q = 0; q < rows5.length; q++) if (rows5[q].profileId === profileId) out.plan.push(rows5[q]);
                // 대화는 **요약만** 옮긴다. 원문은 넣지 않는다 (ROADMAP) —
                // 백업 파일은 사람이 손으로 주고받는 물건이고, 다시 읽을 값어치는 요약 쪽에 있다
                allRows('talks', function (rows6) {
                  for (var t = 0; t < rows6.length; t++) {
                    var r = rows6[t];
                    if (r.profileId !== profileId || !r.summary) continue;
                    out.talkSummaries.push({ key: r.key, profileId: r.profileId, id: r.id,
                                             date: r.date, topic: r.topic, summary: r.summary });
                  }
                  done(out);
                }, function () { done(out); });
              }, function () { done(out); });
            }, fail);
          }, fail);
        }, fail);
      }, fail);
    },

    /* 되살리기. 같은 열쇠는 덮어쓴다. 오답은 열쇠가 자동이라 그냥 더한다. */
    importAll: function (profileId, data, done, fail) {
      if (!data || data.app !== 'dictation') { (fail || noop)('not-ours'); return; }
      var jobs = [
        ['talks', data.talkSummaries || []],
        ['progress', data.progress || []],
        ['cards', data.cards || []],
        ['days', data.days || []],
        ['plan', data.plan || []]
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
