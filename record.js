/* 따라 말하기 — SPEC 6 의 4·5단계.

   녹음은 메모리에만 둔다. 문장이 넘어가면 버린다 (SPEC 2).
   기기가 못 하는 일은 오류 화면 대신 그 버튼만 감춘다 (SPEC 9).

   **멈추기는 무슨 일이 있어도 한 번은 답을 준다.** 아이폰에서는 녹음기가 저 혼자
   멈춰 버리는 일이 있는데(음성인식이 마이크를 가져간다) 그때 브라우저가 멈춤을
   알려 주지 않는다. 알림만 기다리면 답이 영영 안 와서 단추가 'Stop' 인 채로 굳는다 —
   실제로 겪었다. 그래서 알림·상태·시계 세 가지로 받는다. */
window.Recorder = (function () {
  var WAIT_MS = 1500;      // 멈춤 알림을 이만큼 기다려 보고, 안 오면 그냥 끝낸다
  var SPEECH_MS = 250;     // 음성인식 결과가 조금 늦게 오기도 한다
  var SHORT_MS = 700;      // 이보다 짧으면 손이 미끄러진 것으로 본다

  var stream = null;
  var rec = null;
  var chunks = [];
  var url = null;          // 마지막 녹음. 메모리에만 있다
  var speech = null;
  var heard = '';

  var gen = 0;             // 녹음 한 판마다 늘린다. 지난 판의 알림이 이번 판을 건드리면 안 된다
  var sealed = false;      // 이번 판의 소리를 다 뭉쳤는지
  var waiting = [];        // 멈추기를 기다리는 쪽들. 저마다 한 번씩만 답을 받는다
  var guard = null;        // 멈춤 알림이 안 올 때를 대비한 시계
  var startedAt = 0;
  var micEnded = false;    // 녹음 도중에 마이크를 뺏겼는지
  var usedSpeech = false;  // 이번 판에 음성인식을 함께 돌렸는지
  var noSpeech = false;    // 이 기기에서는 둘이 같이 안 된다고 판명됐는지

  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function speechCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /* 마이크를 뺏겨 본 기기에서는 더 이상 받아적지 않는다. 녹음이 먼저다 (SPEC 9) */
  function canTranscribe() { return !noSpeech && !!speechCtor(); }

  /* 녹음 시작. 마이크 권한은 처음 한 번만 물어본다(브라우저가 기억한다). */
  function start(onReady, onFail) {
    if (!canRecord()) { onFail('unsupported'); return; }
    discard();
    gen++;
    var mine = gen;

    function begin(s) {
      if (mine !== gen) {                     // 기다리는 사이에 다음 판이 시작됐다
        stopTracks(s);
        return;
      }
      stream = s;
      chunks = [];
      try { rec = new MediaRecorder(s); }
      catch (e) { onFail('unsupported'); return; }

      rec.ondataavailable = function (e) {
        if (mine === gen && e.data && e.data.size) chunks.push(e.data);
      };
      // 멈춤 알림은 **시작할 때** 붙여 둔다. 녹음기가 저 혼자 멈춰도 소리를 건지게
      rec.onstop = function () { if (mine === gen) seal(); };
      rec.onerror = function () { if (mine === gen) seal(); };

      watchMic(s, mine);
      startedAt = (new Date()).getTime();
      try { rec.start(); }
      catch (e) { release(); onFail('failed'); return; }

      if (!noSpeech) listen(mine);
      onReady();
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(begin, function (err) {
      onFail(err && err.name === 'NotAllowedError' ? 'denied' : 'failed');
    });
  }

  /* 아이폰은 마이크를 한 곳에만 준다. 음성인식이 가져가면 녹음이 그 자리에서 끊긴다.
     그런 기기라는 것을 알면 다음 판부터는 음성인식을 아예 걸지 않는다. */
  function watchMic(s, mine) {
    var tracks = s.getAudioTracks ? s.getAudioTracks() : [];
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].onended = function () {
        if (mine !== gen) return;
        micEnded = true;
        if (usedSpeech) noSpeech = true;
        seal();
      };
    }
  }

  /* 음성인식은 되는 기기에서만. 안 되면 녹음만 하고 넘어간다. */
  function listen(mine) {
    var Ctor = speechCtor();
    if (!Ctor) return;
    try {
      speech = new Ctor();
      speech.lang = 'en-US';
      speech.interimResults = false;
      speech.maxAlternatives = 1;
      speech.onresult = function (e) {
        if (mine !== gen) return;
        var out = '';
        for (var i = 0; i < e.results.length; i++) out += e.results[i][0].transcript + ' ';
        heard = out.replace(/\s+/g, ' ').trim();
      };
      speech.onerror = function () { speech = null; };
      speech.start();
      usedSpeech = true;
    } catch (e) { speech = null; }
  }

  /* 모아 둔 소리를 뭉쳐 두고, 기다리는 쪽이 있으면 답한다. 두 번 뭉치지 않는다 */
  function seal() {
    if (!sealed) {
      sealed = true;
      if (guard) { clearTimeout(guard); guard = null; }
      if (chunks.length) {
        try {
          var blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
          url = window.URL.createObjectURL(blob);
        } catch (e) { url = null; }
      }
      release();
    }
    hand();
  }

  function hand() {
    if (!waiting.length) return;
    var cbs = waiting;
    var got = url;
    var note = why();
    waiting = [];
    // 음성인식 결과는 조금 늦게 오므로 그만큼 기다렸다 답한다.
    // 기다리는 쪽을 하나라도 빠뜨리면 그쪽 화면이 굳는다
    setTimeout(function () {
      for (var i = 0; i < cbs.length; i++) cbs[i](got, heard, note);
    }, SPEECH_MS);
  }

  /* 소리가 안 남았으면 왜 그런지 말해 준다. 조용히 실패하지 않는다 */
  function why() {
    if (url) return '';
    if (micEnded) return 'mic-taken';
    if (startedAt && (new Date()).getTime() - startedAt < SHORT_MS) return 'too-short';
    return 'empty';
  }

  function stop(cb) {
    if (cb) waiting.push(cb);
    if (speech) { try { speech.stop(); } catch (e) {} }

    if (sealed || !rec) { seal(); return; }

    // 이미 멈춰 있는 녹음기는 멈춤 알림을 보내지 않는다. 그 자리에서 끝낸다
    var state = '';
    try { state = rec.state || ''; } catch (e) { state = ''; }
    if (state && state !== 'recording' && state !== 'paused') { seal(); return; }

    try { if (rec.requestData) rec.requestData(); } catch (e) {}
    // 알림이 영영 안 오는 기기가 있다. 시계를 걸어 두고 때가 되면 그냥 끝낸다
    guard = setTimeout(seal, WAIT_MS);
    try { rec.stop(); } catch (e) { seal(); }
  }

  function stopTracks(s) {
    var tracks = (s && s.getTracks) ? s.getTracks() : [];
    for (var i = 0; i < tracks.length; i++) {
      try { tracks[i].onended = null; } catch (e) {}
      try { tracks[i].stop(); } catch (e) {}
    }
  }

  function release() {
    stopTracks(stream);
    stream = null;
    rec = null;
  }

  /* 문장이 넘어가면 버린다 */
  function discard() {
    gen++;
    if (guard) { clearTimeout(guard); guard = null; }
    waiting = [];
    sealed = false;
    chunks = [];
    heard = '';
    micEnded = false;
    usedSpeech = false;
    startedAt = 0;
    release();
    if (speech) { try { speech.abort(); } catch (e) {} speech = null; }
    if (url) { try { window.URL.revokeObjectURL(url); } catch (e) {} url = null; }
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
