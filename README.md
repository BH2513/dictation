# dictation

유튜브 영상으로 하는 가족용 영어 받아쓰기·말하기 연습 앱.

- 사이트: https://bh2513.github.io/dictation/
- **앱으로 설치하는 법: [INSTALL.md](INSTALL.md)** (PC 바탕화면 / 아이폰 홈 화면)
- 만들려는 것: [SPEC.md](SPEC.md)
- 앞으로의 계획과 비용 계산: [ROADMAP.md](ROADMAP.md)
- 영상 등록하는 법: [tools/README.md](tools/README.md)
- 하루 문장 자동 생성 준비: [tools/DAILY_SETUP.md](tools/DAILY_SETUP.md)
- 드라마·영화 대사로 연습하기: [tools/SUBS_SETUP.md](tools/SUBS_SETUP.md)
- 대화 연습 준비 (AI 열쇠): [tools/TALK_SETUP.md](tools/TALK_SETUP.md)

## 지금 되는 것

- **받아쓰기** — 영상 구간을 문장 단위로 듣고 받아쓴다. 채점, 힌트, 따라 말하기
- **하루 다섯 문장** — 한국어를 보고 영어로 옮겨 말한다. 매일 아침 새로 만들어진다.
  탭이 둘 — AI 가 만든 문장 / 등록한 자막의 실제 드라마·영화 대사
- **문장카드** — 손으로 담은 문장을 앞면 한국어 / 뒷면 영어로 다시 본다.
  영상에서 온 카드는 그 자리로 가서 한 번 더 듣고 돌아온다
- **오답 리포트** — 연속 학습 일수, 최근 14일 학습량, 자주 틀리는 낱말
- **대화 연습** — 영어로 말하면 **내 문장을 먼저 고쳐 주고** 나서 대답한다.
  끝내면 잘한 것·고칠 것·배울 표현을 정리해 준다. AI 열쇠를 넣어야 돈다 (`Settings`)
- **주간 판정표** — 대화 연습으로 넘어갈지 주마다 보는 숫자 (리포트 화면 안)
- **백업** — 기기를 바꿀 때 기록을 옮긴다
- **영상 등록 스크립트** (`tools/add_video.py`) — PC에서 자막을 받아 문장으로 자른다

## 만드는 사람 참고

- 빌드 단계 없음. 정적 파일 그대로 GitHub Pages 에 올라간다
- 서버 없음, 비용 0원
- `app.js` / `style.css` 등을 고쳤으면 `index.html` 의 `?v=` 값을 올린다
- 테스트: `python3 tools/test_add_video.py`, `python3 tools/test_add_subs.py`,
  `node tools/test_daily.js`, `node tools/test_daily_shows.js`, `node tools/test_grading.js`,
  `node tools/test_gate.js`, `node tools/test_talk.js`, `node tools/test_talkwait.js`,
  `node tools/test_talkcost.js`, `node tools/test_prefs.js`
