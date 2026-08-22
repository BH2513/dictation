# -*- coding: utf-8 -*-
"""자막에서 대사를 뽑는 쪽의 검사. 네트워크도 파일도 필요 없다.

돌리는 법:  python3 tools/test_add_subs.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import add_subs as S

failed = 0


def check(name, got, want):
    global failed
    ok = got == want
    print(("  OK   " if ok else "  실패 ") + name)
    if not ok:
        print("       받은 값: " + repr(got))
        print("       기대값: " + repr(want))
        failed += 1


SITCOM = """1
00:00:01,000 --> 00:00:03,500
<i>Previously on the show...</i>

2
00:00:04,000 --> 00:00:07,000
I'm telling you, that is not
what happened at the party.

3
00:00:07,100 --> 00:00:09,000
She was already gone
by the time I got there.

4
00:00:09,500 --> 00:00:11,000
- Are you serious right now?
- I am completely serious.

5
00:00:11,500 --> 00:00:13,000
[door slams]

6
00:00:13,500 --> 00:00:15,000
MONICA: Okay, everybody just
calm down for one second.

7
00:00:15,500 --> 00:00:18,000
♪ I'll be there for you ♪

8
00:00:18,500 --> 00:00:21,000
Look, I know you're upset,
but you have to hear me out on this.
"""

print("\n자막 해석 — 시각 줄과 번호는 빼고 글만")
cues = S.cues_srt(SITCOM)
check("시각·번호 줄을 뺀다", any("-->" in c for c in cues), False)
check("화자가 바뀌면 따로 뗀다",
      [c.strip() for c in cues if "serious" in c],
      ["- Are you serious right now?", "- I am completely serious."])

print("\n글 다듬기")
check("기울임 표시를 뺀다", S.clean_line("<i>Previously on the show...</i>"),
      "Previously on the show...")
check("소리 설명을 뺀다", S.clean_line("[door slams] He left."), "He left.")
check("괄호 설명을 뺀다", S.clean_line("(sighs) I know."), "I know.")
check("화자 이름표를 뗀다", S.clean_line("MONICA: Okay, calm down."), "Okay, calm down.")
check("대화 앞줄표를 뗀다", S.clean_line("- I am completely serious."),
      "I am completely serious.")
check("자막 위치 지정을 뺀다", S.clean_line("{\\an8}Up here."), "Up here.")
check("음표 줄은 말이 아니라고 본다", S.is_break("♪ I'll be there for you ♪"), True)
check("소리 설명만 있는 칸도 말이 아니다", S.is_break("[door slams]"), True)
check("보통 대사는 말이다", S.is_break("I am completely serious."), False)

print("\n한 마디로 이어 붙이기 — 시트콤 대사는 짧아서 이게 중요하다")
joined = S.join_cues(cues)
check("두 칸에 나뉜 한 문장을 붙인다",
      "I'm telling you, that is not what happened at the party." in joined, True)
check("다른 사람 말과 섞지 않는다",
      any(j.startswith("Previously") and "telling you" in j for j in joined), False)
check("한 칸에 두 문장이면 통째로 살린다",
      "Look, I know you're upset, but you have to hear me out on this." in joined, True)

print("\n쓸 만한 줄인지")
check("문장부호로 끝나야 한다", S.usable("This is a complete sentence here"), False)
check("너무 짧으면 뺀다", S.usable("Are you serious?"), False)
check("너무 길면 뺀다", S.usable("word " * 40 + "end."), False)
check("전부 대문자면 뺀다", S.usable("WHAT ARE YOU DOING RIGHT NOW HERE."), False)
check("자막 제작자 표시는 뺀다",
      S.usable("Subtitles by the community at opensubtitles.org here."), False)
check("멀쩡한 것은 통과",
      S.usable("She was already gone by the time I got there."), True)

print("\n파일 이름에서 작품 이름 뽑기")
check("화질·코덱 표시를 뗀다",
      S.title_of("/x/Modern.Family.S03E12.720p.WEB-DL.x264.eng.srt"),
      "Modern Family S03E12")
check("점을 띄어쓰기로", S.title_of("/x/Friends.S01E01.srt"), "Friends S01E01")

print("\n자막 품질 판단 — 눈으로 못 고르니 도구가 봐 준다")
AUTO = "\n\n".join(
    "%d\n00:00:0%d,000 --> 00:00:0%d,000\nokay so then i said to him you know" % (i, i % 9, (i + 1) % 9)
    for i in range(1, 25))
check("자동 생성 자막을 잡는다 (문장부호가 없다)",
      S.judge(AUTO, S.cues_srt(AUTO), [])[0], "bad")
check("한국어 자막을 잡는다",
      S.judge("안녕하세요 반갑습니다 오늘은 " * 40, ["안녕하세요"], [])[0], "bad")
check("글이 너무 적으면 잡는다", S.judge("Hi there.", ["Hi there."], [])[0], "bad")
check("멀쩡하면 통과",
      S.judge(SITCOM * 30, S.cues_srt(SITCOM * 30), ["x"] * 40)[0], "ok")
check("줄이 적으면 알려는 준다",
      S.judge(SITCOM * 30, S.cues_srt(SITCOM * 30), ["x"] * 5)[0], "weak")

print("\n골고루 뽑기 — 한 작품이 다 차지하면 안 된다")
picked = S.spread({"A": ["a1", "a2", "a3"], "B": ["b1", "b2", "b3"]}, 4,
                  __import__("random").Random(1))
check("두 작품에서 반씩", sorted(p["source"] for p in picked), ["A", "A", "B", "B"])
check("있는 것보다 많이 달라고 하면 있는 만큼",
      len(S.spread({"A": ["a1"]}, 10, __import__("random").Random(1))), 1)
check("다른 작품에 같은 대사가 있으면 한 번만",
      len(S.spread({"A": ["same line."], "B": ["same line."]}, 10,
                   __import__("random").Random(1))), 1)
check("대소문자만 달라도 같은 것으로 본다",
      len(S.spread({"A": ["Same Line."], "B": ["same line."]}, 10,
                   __import__("random").Random(1))), 1)

print("\n인코딩 — 자막은 인코딩이 제각각이다")
import tempfile
for enc in ("utf-8", "cp949", "utf-16"):
    fd, path = tempfile.mkstemp(suffix=".srt")
    os.close(fd)
    open(path, "wb").write("Hello there.".encode(enc))
    check(enc + " 로 저장된 것도 읽는다", "Hello" in S.read_text(path), True)
    os.remove(path)

print("\n실패 %d건\n" % failed if failed else "\n전부 통과\n")
sys.exit(1 if failed else 0)
