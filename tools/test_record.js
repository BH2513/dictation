// record.js 의 멈추기를 확인한다 (브라우저 없이).
//
// 확인하려는 것은 하나다 — **멈추기는 어떤 경우에도 한 번은 답을 준다.**
// 아이폰에서 답이 안 와서 단추가 'Stop' 인 채로 굳은 적이 있다.
//
//     node tools/test_record.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'record.js'), 'utf8');

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  OK   ' : '  실패 ') + name);
  if (!ok) { console.log('       받은 값:', JSON.stringify(got), '기대값:', JSON.stringify(want)); failed++; }
}

/* 브라우저인 척하는 최소한의 자리.
   how 로 그 기기가 어떻게 어긋나는지 정한다. */
function makeRecorder(how) {
  const track = { readyState: 'live', onended: null, stop() { this.readyState = 'ended'; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

  class FakeRecorder {
    constructor() { this.state = 'inactive'; this.ondataavailable = null; this.onstop = null; this.onerror = null; }
    data() {
      if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x'.repeat(64)], { type: 'audio/webm' }) });
    }
    start() {
      this.state = 'recording';
      if (!how.quiet) setTimeout(() => { if (this.state === 'recording') this.data(); }, 20);
      // 누르기도 전에 저 혼자 멈추면서 알려 주지도 않는 기기
      if (how.selfStop) setTimeout(() => { this.state = 'inactive'; }, 30);
    }
    requestData() { if (!how.quiet && this.state === 'recording') this.data(); }
    stop() {
      if (how.throwOnStop) throw new Error('InvalidStateError');
      this.state = 'inactive';
      if (how.noOnStop) return;            // 멈췄다고 알려 주지 않는다 (아이폰에서 겪은 것)
      setTimeout(() => { if (this.onstop) this.onstop(); }, 5);
    }
  }

  const win = {
    MediaRecorder: FakeRecorder,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }
  };
  if (how.speech) {
    win.webkitSpeechRecognition = class {
      start() {
        if (!how.speechTakesMic) return;
        // 아이폰: 음성인식이 마이크를 가져가면 녹음 쪽 소리가 끊긴다
        setTimeout(() => { track.readyState = 'ended'; if (track.onended) track.onended(); }, 10);
      }
      stop() {} abort() {}
    };
  }

  // node 는 navigator 를 읽기 전용으로 들고 있어서 그냥 넣으면 안 들어간다
  const set = (k, v) => Object.defineProperty(global, k, { value: v, configurable: true, writable: true });
  set('window', win);
  set('MediaRecorder', FakeRecorder);
  set('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } });
  eval(SRC);                               // 판마다 새로 읽어 기억을 지운다
  return { rec: win.Recorder, track: track, recorderClass: FakeRecorder };
}

/* 시작 → (기다림) → 멈추기. 답이 오면 그 내용을, 안 오면 'no answer' 를 돌려준다 */
function run(how, waitMs, holdMs) {
  return new Promise((done) => {
    const env = makeRecorder(how);
    env.rec.start(() => {
      setTimeout(() => {
        let answered = false;
        env.rec.stop((url, heard, note) => {
          answered = true;
          done({ got: url ? 'sound' : 'none', note: note || '', canTranscribe: env.rec.canTranscribe() });
        });
        setTimeout(() => { if (!answered) done({ got: 'no answer', note: '', canTranscribe: null }); },
          waitMs || 3000);
      }, holdMs === undefined ? 60 : holdMs);
    }, (why) => done({ got: 'start failed: ' + why, note: '', canTranscribe: null }));
  });
}

(async () => {
  console.log('\n멈추기는 어떤 경우에도 답을 준다');

  let r = await run({ speech: false });
  check('보통 기기 — 소리를 받아 온다', [r.got, r.note], ['sound', '']);

  r = await run({ speech: false, noOnStop: true });
  check('멈췄다고 알려 주지 않는 기기 — 시계가 대신 끝낸다 (아이폰)', [r.got, r.note], ['sound', '']);

  r = await run({ speech: false, throwOnStop: true });
  check('멈추기가 튕기는 기기 — 그래도 답한다', r.got, 'sound');

  r = await run({ speech: false, selfStop: true, noOnStop: true });
  check('누르기 전에 저 혼자 멈춘 기기 — 모아 둔 소리를 건진다', r.got, 'sound');

  r = await run({ speech: false, quiet: true, noOnStop: true });
  check('소리를 한 조각도 안 주는 기기 — 빈손이라고 답한다', [r.got, r.note], ['none', 'empty']);

  console.log('\n왜 빈손인지 말해 준다 (조용히 실패하지 않는다)');

  r = await run({ speech: false, quiet: true }, 3000, 10);
  check('너무 짧게 눌렀을 때', [r.got, r.note], ['none', 'too-short']);

  console.log('\n아이폰 — 음성인식이 마이크를 가져가는 기기');

  r = await run({ speech: true, speechTakesMic: true, quiet: true });
  check('마이크를 뺏긴 것을 알아본다', [r.got, r.note], ['none', 'mic-taken']);
  check('그 뒤로는 받아적기를 걸지 않는다', r.canTranscribe, false);

  console.log('\n음성인식이 멀쩡한 기기에서는 그대로 쓴다');
  r = await run({ speech: true, speechTakesMic: false });
  check('녹음도 되고 받아적기도 살아 있다', [r.got, r.canTranscribe], ['sound', true]);

  console.log('\n두 번 눌러도 기다리는 쪽은 모두 답을 받는다');
  await new Promise((done) => {
    const env = makeRecorder({ speech: false });
    env.rec.start(() => {
      setTimeout(() => {
        let times = 0;
        env.rec.stop(() => { times++; });
        env.rec.stop(() => { times++; });
        setTimeout(() => { check('두 번 다 답이 왔다', times, 2); done(); }, 900);
      }, 60);
    }, () => done());
  });

  console.log(failed ? '\n실패 ' + failed + ' 건\n' : '\n모두 통과\n');
  process.exit(failed ? 1 : 0);
})();
