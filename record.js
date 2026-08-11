/* 따라 말하기 — SPEC 6 의 4·5단계.

   녹음은 메모리에만 둔다. 문장이 넘어가면 버린다 (SPEC 2).
   기기가 못 하는 일은 오류 화면 대신 그 버튼만 감춘다 (SPEC 9). */
window.Recorder = (function () {
  var stream = null;
  var rec = null;
  var chunks = [];
  var url = null;          // 마지막 녹음. 메모리에만 있다
  var speech = null;
  var heard = '';

  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function speechCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function canTranscribe() { return !!speechCtor(); }

  /* 녹음 시작. 마이크 권한은 처음 한 번만 물어본다(브라우저가 기억한다). */
  function start(onReady, onFail) {
    if (!canRecord()) { onFail('unsupported'); return; }
    discard();
    heard = '';

    function begin(s) {
      stream = s;
      chunks = [];
      try { rec = new MediaRecorder(s); }
      catch (e) { onFail('unsupported'); return; }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function () { onFail('failed'); };
      rec.start();
      listen();
      onReady();
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(begin, function (err) {
      onFail(err && err.name === 'NotAllowedError' ? 'denied' : 'failed');
    });
  }

  /* 음성인식은 되는 기기에서만. 안 되면 녹음만 하고 넘어간다. */
  function listen() {
    var Ctor = speechCtor();
    if (!Ctor) return;
    try {
      speech = new Ctor();
      speech.lang = 'en-US';
      speech.interimResults = false;
      speech.maxAlternatives = 1;
      speech.onresult = function (e) {
        var out = '';
        for (var i = 0; i < e.results.length; i++) out += e.results[i][0].transcript + ' ';
        heard = out.replace(/\s+/g, ' ').trim();
      };
      speech.onerror = function () { speech = null; };
      speech.start();
    } catch (e) { speech = null; }
  }

  function stop(done) {
    if (speech) { try { speech.stop(); } catch (e) {} }
    if (!rec) { done(null, heard); return; }

    rec.onstop = function () {
      var blob = new Blob(chunks, { type: chunks.length && chunks[0].type ? chunks[0].type : 'audio/webm' });
      url = window.URL.createObjectURL(blob);
      release();
      // 음성인식 결과가 조금 늦게 오기도 한다
      setTimeout(function () { done(url, heard); }, 250);
    };
    try { rec.stop(); } catch (e) { release(); done(null, heard); }
  }

  function release() {
    if (stream) {
      var tracks = stream.getTracks ? stream.getTracks() : [];
      for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) {} }
    }
    stream = null;
    rec = null;
  }

  /* 문장이 넘어가면 버린다 */
  function discard() {
    release();
    if (speech) { try { speech.abort(); } catch (e) {} speech = null; }
    if (url) { try { window.URL.revokeObjectURL(url); } catch (e) {} url = null; }
    chunks = [];
    heard = '';
  }

  return {
    canRecord: canRecord,
    canTranscribe: canTranscribe,
    start: start,
    stop: stop,
    discard: discard,
    lastUrl: function () { return url; },
    lastHeard: function () { return heard; }
  };
})();
