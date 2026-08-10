#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""add_video.py 의 자막 해석과 문장 분할을 확인한다.

유튜브에 연결하지 않고 자막 문자열만으로 검사한다.

    python tools/test_add_video.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from add_video import (extract_video_id, parse_vtt, words_from_cues,
                       units_from_words, split_sentences, to_sentences,
                       attach_korean, pick_korean, rate_limited,
                       looks_punctuated, clean)

FAILED = []


def check(name, got, want):
    if got == want:
        print("  OK   " + name)
    else:
        print("  실패 " + name)
        print("       받은 값: %r" % (got,))
        print("       기대값: %r" % (want,))
        FAILED.append(name)


def sentences_of(vtt, use_words=False, use_punct=True, use_capital=True):
    cues = parse_vtt(vtt)
    if use_words:
        units = units_from_words(words_from_cues(cues), cues[-1]["end"])
    else:
        units = [{"start": c["start"], "end": c["end"], "text": c["text"]} for c in cues]
    return to_sentences(split_sentences(units, use_punct=use_punct, use_capital=use_capital))


# ---------------------------------------------------------------- 영상 ID

print("\n영상 ID 알아보기")
check("순수 ID", extract_video_id("SW2bVwdr8Zg"), "SW2bVwdr8Zg")
check("watch 주소", extract_video_id("https://www.youtube.com/watch?v=SW2bVwdr8Zg"), "SW2bVwdr8Zg")
check("공유 주소 + 파라미터",
      extract_video_id("https://youtu.be/SW2bVwdr8Zg?si=abcdef"), "SW2bVwdr8Zg")
check("shorts", extract_video_id("https://www.youtube.com/shorts/SW2bVwdr8Zg"), "SW2bVwdr8Zg")
check("알아볼 수 없는 값", extract_video_id("그냥 글자"), "")


# ---------------------------------------------------------------- 직접 단 자막

MANUAL = """WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello everyone, welcome back.

2
00:00:03.100 --> 00:00:05.500
Today we are going to talk

3
00:00:05.500 --> 00:00:07.000
about the weather.

4
00:00:09.000 --> 00:00:11.000
It has been raining all week.
"""

print("\n직접 단 자막 — 구두점과 무음으로 나누기")
s = sentences_of(MANUAL)
check("문장 개수", len(s), 3)
check("1번 문장", s[0]["text"], "Hello everyone, welcome back.")
check("2번 문장 — 마침표 없는 줄은 이어붙임",
      s[1]["text"], "Today we are going to talk about the weather.")
check("2번 시작은 첫 조각의 start", s[1]["start"], 3.1)
check("2번 끝은 마지막 조각의 end", s[1]["end"], 7.0)
check("3번 문장 — 무음 2초로 경계", s[2]["text"], "It has been raining all week.")


CAPITAL = """WEBVTT

00:00:01.000 --> 00:00:02.000
i went to the store and

00:00:02.000 --> 00:00:03.000
Sarah was already there

00:00:03.000 --> 00:00:04.000
waiting for me, and
"""
print("\n직접 단 자막 — 대문자 시작 규칙")
s = sentences_of(CAPITAL)
check("대문자로 시작하면 경계", len(s), 2)
check("경계 위치", s[1]["text"], "Sarah was already there waiting for me, and")

MID_I = """WEBVTT

00:00:01.000 --> 00:00:02.000
he said that

00:00:02.000 --> 00:00:03.000
I should come back later
"""
print("\n직접 단 자막 — 문장 중간의 I 는 자르지 않음")
s = sentences_of(MID_I)
check("한 문장으로 유지", len(s), 1)

COMMA = """WEBVTT

00:00:01.000 --> 00:00:02.000
after the meeting,

00:00:02.000 --> 00:00:03.000
Tom went home
"""
print("\n직접 단 자막 — 쉼표 뒤 대문자는 자르지 않음")
check("한 문장으로 유지", len(sentences_of(COMMA)), 1)


# ---------------------------------------------------------------- 강제 분할

LONG_TIME = "WEBVTT\n\n" + "\n\n".join(
    "00:00:%02d.000 --> 00:00:%02d.000\nline%d and more words here" % (i * 4, i * 4 + 4, i)
    for i in range(6))
print("\n강제 분할 — 15초")
s = sentences_of(LONG_TIME)
check("모든 문장이 15초 이하", all(x["end"] - x["start"] <= 15.0 for x in s), True)
check("두 개 이상으로 나뉨", len(s) > 1, True)

MANY_WORDS = "WEBVTT\n\n" + "\n\n".join(
    "00:00:0%d.000 --> 00:00:0%d.000\nword word word word word word" % (i, i + 1)
    for i in range(0, 8))
print("\n강제 분할 — 25단어")
s = sentences_of(MANY_WORDS)
check("모든 문장이 25단어 이하",
      all(len(x["text"].split()) <= 25 for x in s), True)


# ---------------------------------------------------------------- 자동생성 자막

AUTO = """WEBVTT
Kind: captions
Language: en

00:00:00.030 --> 00:00:02.669 align:start position:0%
hello<00:00:00.719><c> everyone</c><00:00:01.200><c> welcome</c>

00:00:02.669 --> 00:00:02.679 align:start position:0%
hello everyone welcome

00:00:02.679 --> 00:00:05.099 align:start position:0%
hello everyone welcome
back<00:00:03.100><c> to</c><00:00:03.400><c> the</c><00:00:03.700><c> show</c>

00:00:08.000 --> 00:00:10.000 align:start position:0%
today<00:00:08.400><c> we</c><00:00:08.800><c> begin</c>
"""

print("\n자동생성 자막 — 반복되는 줄 걸러내기")
cues = parse_vtt(AUTO)
words = words_from_cues(cues)
check("단어가 중복 없이 뽑힘",
      [w["w"] for w in words],
      ["hello", "everyone", "welcome", "back", "to", "the", "show",
       "today", "we", "begin"])
check("첫 단어 시각", words[0]["t"], 0.03)
check("둘째 단어 시각", words[1]["t"], 0.719)

s = sentences_of(AUTO, use_words=True, use_punct=False, use_capital=False)
print("자동생성 자막 — 무음으로만 나누기")
check("무음 2.9초에서 두 문장으로", len(s), 2)
check("1번 문장", s[0]["text"], "hello everyone welcome back to the show")
check("2번 문장", s[1]["text"], "today we begin")
check("2번 시작 시각 — 큐가 뜨기 조금 전", s[1]["start"], 7.72)


# ---------------------------------------------------------------- 한국어 붙이기

KO = """WEBVTT

00:00:01.000 --> 00:00:03.000
안녕하세요 여러분

00:00:03.100 --> 00:00:07.000
오늘은 날씨에 대해 이야기하겠습니다

00:00:09.000 --> 00:00:11.000
일주일 내내 비가 왔습니다
"""
print("\n한국어 자막 붙이기")
s = attach_korean(sentences_of(MANUAL), parse_vtt(KO))
check("1번 한국어", s[0].get("ko"), "안녕하세요 여러분")
check("2번 한국어", s[1].get("ko"), "오늘은 날씨에 대해 이야기하겠습니다")
check("3번 한국어", s[2].get("ko"), "일주일 내내 비가 왔습니다")

print("\n한국어 자막이 없을 때")
s = attach_korean(sentences_of(MANUAL), [])
check("ko 필드를 넣지 않음", "ko" in s[0], False)
check("recording 은 항상 null", [x["recording"] for x in s], [None, None, None])
check("i 는 0부터 차례로", [x["i"] for x in s], [0, 1, 2])


# ---------------------------------------------------------------- 공백만 있는 줄

# 실제로 겪은 것: 유튜브 자동자막은 자막 조각 안에 공백 한 칸짜리 줄을 넣는다.
# 그걸 "조각 끝"으로 보면 그 뒤 내용을 통째로 잃고, 그 말은 2초 뒤 조각에서
# 주워지면서 문장 시작이 그만큼 늦어진다.
SPACE_LINE = "WEBVTT\nKind: captions\nLanguage: en\n\n" + \
    "00:00:10.559 --> 00:00:12.790 align:start position:0%\n" + \
    " \n" + \
    "I<00:00:10.800><c> have</c><00:00:10.880><c> no</c><00:00:11.360><c> idea.</c>\n"

print("\n공백 한 칸짜리 줄이 있는 자막")
cues_sp = parse_vtt(SPACE_LINE)
check("조각을 잃지 않음", len(cues_sp), 1)
check("내용을 다 읽음", cues_sp[0]["text"], "I have no idea.")
w_sp = words_from_cues(cues_sp)
check("단어 수", len(w_sp), 4)
check("첫 단어가 조각 시각 근처에 놓임", w_sp[0]["t"] < 10.56, True)


# ---------------------------------------------------------------- 시각 없는 앞 단어

# 실제로 겪은 것: "And we can go into that at another time." 을 재생하면
# "go into" 부터 들렸다. 시각 없는 앞 단어 셋에 큐가 뜬 시각을 줘서
# 문장 시작이 통째로 늦게 잡혔기 때문이다.
LEADING = """WEBVTT
Kind: captions
Language: en

00:00:24.480 --> 00:00:27.120 align:start position:0%
You<00:00:24.800><c> know</c><00:00:25.200><c> him</c><00:00:25.600><c> publicly.</c>

00:00:27.120 --> 00:00:29.190 align:start position:0%
You know him publicly.
And we can<00:00:27.900><c> go</c><00:00:28.200><c> into</c><00:00:28.500><c> that.</c>
"""

print("\n시각 표시가 없는 앞 단어")
w = words_from_cues(parse_vtt(LEADING))
byword = {}
for x in w:
    byword.setdefault(x["w"], x["t"])
check("단어 순서", [x["w"] for x in w],
      ["You", "know", "him", "publicly.", "And", "we", "can", "go", "into", "that."])
check("앞 단어들이 큐가 뜬 27.12 보다 앞에 놓임",
      all(byword[x] < 27.12 for x in ["And", "we", "can"]), True)
check("앞 단어보다 뒤에 놓임", byword["And"] > byword["publicly."], True)
check("차례를 지킴", byword["And"] < byword["we"] < byword["can"], True)

s2 = sentences_of(LEADING, use_words=True, use_punct=True, use_capital=False)
check("두 문장으로 나뉨", len(s2), 2)
check("두 번째 문장", s2[1]["text"], "And we can go into that.")
check("두 번째 문장이 큐 시각(27.12)보다 일찍 시작", s2[1]["start"] < 27.12, True)


# ---------------------------------------------------------------- 구두점 있는 자동자막

PUNCT_AUTO = """WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:04.000 align:start position:0%
I have<00:00:00.500><c> somebody</c><00:00:01.000><c> who</c><00:00:01.500><c> needs</c><00:00:02.000><c> no</c><00:00:02.500><c> introduction.</c><00:00:03.000><c> So,</c><00:00:03.500><c> I&#39;m</c>

00:00:04.000 --> 00:00:08.000 align:start position:0%
not<00:00:04.300><c> going</c><00:00:04.600><c> to</c><00:00:05.000><c> give</c><00:00:05.400><c> him</c><00:00:05.800><c> one.</c><00:00:06.200><c> I</c><00:00:06.600><c> give</c><00:00:07.000><c> you</c><00:00:07.400><c> Bill.</c>
"""

print("\n자동자막에 문장부호가 있을 때")
check("문장부호가 있다고 판정",
      looks_punctuated(" ".join(c["text"] for c in parse_vtt(PUNCT_AUTO)) * 2), True)
check("문장부호가 없으면 아니라고 판정",
      looks_punctuated("hello everyone welcome back to the show today we begin " * 4), False)

s = sentences_of(PUNCT_AUTO, use_words=True, use_punct=True, use_capital=False)
check("마침표마다 나뉨", len(s), 3)
check("1번", s[0]["text"], "I have somebody who needs no introduction.")
check("2번", s[1]["text"], "So, I'm not going to give him one.")
check("3번", s[2]["text"], "I give you Bill.")

NAMES = """WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:04.000 align:start position:0%
Brian<00:00:00.500><c> and</c><00:00:01.000><c> Bill</c><00:00:01.500><c> and</c><00:00:02.000><c> Sarah</c><00:00:02.500><c> talked</c><00:00:03.000><c> about</c><00:00:03.500><c> AI</c>
"""
print("자동자막 — 이름이 나와도 자르지 않음")
check("한 문장으로 유지",
      len(sentences_of(NAMES, use_words=True, use_punct=True, use_capital=False)), 1)


# ---------------------------------------------------------------- 소리 표시와 화자 표시

print("\n소리 표시와 화자 표시")
check("[applause] 자리에 경계 표시를 남긴다",
      clean("thank you [applause] very much"), "thank you \u2016 very much")
check("[Music] 만 있는 줄은 경계 표시만", clean("[Music]"), "\u2016")

# 실제로 겪은 것: 박수 구간을 그냥 지웠더니 그 앞뒤 문장이 맞붙었다.
APPLAUSE = """WEBVTT
Kind: captions
Language: en

00:00:05.000 --> 00:00:10.500 align:start position:0%
I<00:00:05.300><c> give</c><00:00:05.700><c> you</c><00:00:06.200><c> Bill</c><00:00:08.500><c> [applause]</c>

00:00:10.550 --> 00:00:13.000 align:start position:0%
I<00:00:10.800><c> have</c><00:00:11.300><c> no</c><00:00:11.900><c> idea.</c>
"""
s_ap = sentences_of(APPLAUSE, use_words=True, use_punct=True, use_capital=False)
check("박수 구간에서 문장이 나뉨", len(s_ap), 2)
check("박수는 글자에 남지 않음", "[" not in s_ap[0]["text"] and "\u2016" not in s_ap[0]["text"], True)
check("앞 문장이 박수 시작에서 끝남", s_ap[0]["end"], 8.5)

SPEAKER = """WEBVTT

00:00:01.000 --> 00:00:03.000
thanks so much for having me

00:00:03.000 --> 00:00:05.000
>> Okay, glad to be here
"""
s = sentences_of(SPEAKER, use_capital=False)
check("말하는 사람이 바뀌면 경계", len(s), 2)
check("표시는 지운다", s[1]["text"], "Okay, glad to be here")


# ---------------------------------------------------------------- 한국어 자막 고르기

REAL_KO = [{"ext": "vtt", "url": "https://www.youtube.com/api/timedtext?lang=ko&v=x"}]
TRANSLATED_KO = [{"ext": "vtt", "url": "https://www.youtube.com/api/timedtext?lang=en&tlang=ko&v=x"}]

print("\n한국어 자막 고르기")
check("직접 단 한국어가 있으면 그것",
      pick_korean({"ko": REAL_KO}, {"ko": TRANSLATED_KO}), ("ko", False))
check("직접 단 것이 없고 자동자막이 원문이면 사용",
      pick_korean({}, {"ko": REAL_KO}), ("ko", True))
check("자동자막이 영어를 기계번역한 것이면 쓰지 않음",
      pick_korean({}, {"ko": TRANSLATED_KO}), (None, False))
check("한국어가 아예 없을 때", pick_korean({}, {"en": REAL_KO}), (None, False))


print("\n유튜브가 요청을 막았을 때 알아보기")
check("429", rate_limited("ERROR: HTTP Error 429: Too Many Requests"), True)
check("다른 오류", rate_limited("ERROR: Video unavailable"), False)


# ---------------------------------------------------------------- 결과

print("")
if FAILED:
    print("실패 %d개: %s" % (len(FAILED), ", ".join(FAILED)))
    sys.exit(1)
print("전부 통과했습니다.")
