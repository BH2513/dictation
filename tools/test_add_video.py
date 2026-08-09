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
                       attach_korean)

FAILED = []


def check(name, got, want):
    if got == want:
        print("  OK   " + name)
    else:
        print("  실패 " + name)
        print("       받은 값: %r" % (got,))
        print("       기대값: %r" % (want,))
        FAILED.append(name)


def sentences_of(vtt, auto=False, use_words=False):
    cues = parse_vtt(vtt)
    if use_words:
        units = units_from_words(words_from_cues(cues), cues[-1]["end"])
    else:
        units = [{"start": c["start"], "end": c["end"], "text": c["text"]} for c in cues]
    return to_sentences(split_sentences(units, auto=auto))


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

s = sentences_of(AUTO, auto=True, use_words=True)
print("자동생성 자막 — 무음으로만 나누기")
check("무음 2.9초에서 두 문장으로", len(s), 2)
check("1번 문장", s[0]["text"], "hello everyone welcome back to the show")
check("2번 문장", s[1]["text"], "today we begin")
check("2번 시작 시각", s[1]["start"], 8.0)


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


# ---------------------------------------------------------------- 결과

print("")
if FAILED:
    print("실패 %d개: %s" % (len(FAILED), ", ".join(FAILED)))
    sys.exit(1)
print("전부 통과했습니다.")
