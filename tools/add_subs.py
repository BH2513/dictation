# -*- coding: utf-8 -*-
"""드라마·영화 자막에서 연습할 대사를 뽑아 저장소에 올린다 (ROADMAP 1단계, shows 갈래).

왜 이렇게 하나:

  AI 가 영어를 지어내면 아무리 조여도 어색한 것이 섞인다. 그래서 실제로 사람이 한 말을
  쓴다. 자막 파일에서 쓸 만한 줄만 골라 오고, 한국어와 설명은 나중에 AI 가 붙인다.

  자막 파일 전체를 저장소에 넣지는 않는다 — 그건 재배포다. 여기서는 몇백 줄만 뽑아
  올린다. 원본은 PC 에만 남는다. 어학 교재가 문장을 인용하는 것과 같은 정도다.

쓰는 법 (윈도우):

  subs "C:\\자막폴더" bh

  자막 폴더에 .srt / .vtt / .smi 파일을 넣어 두고 위 명령을 돌린다.
  두 달에 한 번쯤만 돌리면 된다 — 매일 다섯 줄 뽑는 것은 저절로 돈다.
"""

import argparse
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from add_video import (ROOT, die, say, check_repo, ensure_profile,
                       read_json, write_json, git_sync, git_publish)

DEFAULT_LINES = 300
MIN_WORDS = 6
MAX_WORDS = 30
EXTS = (".srt", ".vtt", ".smi", ".sami", ".ass", ".ssa")


# ---------------------------------------------------------------- 파일 읽기

def read_text(path):
    """자막 파일은 인코딩이 제각각이다. 되는 것을 찾을 때까지 해 본다."""
    raw = open(path, "rb").read()
    if raw[:3] == b"\xef\xbb\xbf":
        raw = raw[3:]
    for enc in ("utf-8", "cp949", "euc-kr", "utf-16", "latin-1"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return raw.decode("utf-8", "replace")


def find_files(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                if name.lower().endswith(EXTS):
                    out.append(os.path.join(p, name))
        elif os.path.isfile(p):
            if p.lower().endswith(EXTS):
                out.append(p)
            else:
                say("건너뜀 (자막 파일이 아닙니다): " + os.path.basename(p))
    return out


# ---------------------------------------------------------------- 자막 해석

TS = re.compile(r"-->")
INDEX = re.compile(r"^\d+$")


def cues_srt(raw):
    """.srt 와 .vtt 는 모양이 거의 같다. 시각 줄과 번호 줄만 빼면 된다.

    한 칸 안에서 줄이 "-" 로 시작하면 화자가 바뀐 것이다. 그대로 이어 붙이면
    두 사람의 말이 한 문장이 되어 버린다. 따로 떼어 낸다.
    """
    out = []
    for block in re.split(r"\r?\n\r?\n", raw.replace("\r\n", "\n")):
        lines = [l for l in block.split("\n") if l.strip()]
        keep = []
        for line in lines:
            if TS.search(line):
                continue
            if INDEX.match(line.strip()):
                continue
            if line.strip().upper().startswith("WEBVTT"):
                continue
            keep.append(line)
        if not keep:
            continue
        parts, buf = [], []
        for line in keep:
            if re.match(r"^\s*[-\u2013\u2014]\s*\S", line) and buf:
                parts.append(" ".join(buf))
                buf = [line]
            else:
                buf.append(line)
        if buf:
            parts.append(" ".join(buf))
        out.extend(parts)
    return out


def cues_smi(raw):
    """.smi 는 한 줄이 <SYNC ...><P ...>글 꼴이다."""
    out = []
    for part in re.split(r"<SYNC[^>]*>", raw, flags=re.I)[1:]:
        text = re.sub(r"<[^>]+>", " ", part)
        text = text.replace("&nbsp;", " ")
        if text.strip():
            out.append(text)
    return out


def cues_ass(raw):
    """.ass / .ssa 는 Dialogue: 줄의 마지막 칸이 글이다."""
    out = []
    for line in raw.replace("\r\n", "\n").split("\n"):
        if not line.startswith("Dialogue:"):
            continue
        parts = line.split(",", 9)
        if len(parts) >= 10:
            out.append(parts[9])
    return out


def cues_of(path, raw):
    low = path.lower()
    if low.endswith((".smi", ".sami")):
        return cues_smi(raw)
    if low.endswith((".ass", ".ssa")):
        return cues_ass(raw)
    return cues_srt(raw)


# ---------------------------------------------------------------- 글 다듬기

TAG = re.compile(r"<[^>]*>")
BRACE = re.compile(r"\{[^}]*\}")            # {\an8} 같은 위치 지정
BRACKET = re.compile(r"\[[^\]]*\]")         # [문 여는 소리]
PAREN = re.compile(r"\([^)]*\)")            # (한숨)
SPEAKER = re.compile(r"^[-\s]*[A-Z][A-Z0-9 '\.\-]{1,20}:\s*")
CREDIT = re.compile(r"(subtitle|sync|caption|opensubtitles|자막|번역|www\.|http)", re.I)


def clean_line(text):
    t = TAG.sub(" ", text)
    t = BRACE.sub(" ", t)
    t = BRACKET.sub(" ", t)
    t = PAREN.sub(" ", t)
    t = t.replace("\u266a", " ").replace("\u266b", " ").replace("&nbsp;", " ")
    t = t.replace("\u200b", " ")
    t = SPEAKER.sub("", t)
    t = re.sub(r"^[-\u2013\u2014]\s*", "", t)          # 대화 표시 앞줄표
    t = re.sub(r"\s+", " ", t).strip()
    return t


MUSIC = re.compile(r"[\u266a\u266b\u2669\u266c]")


def is_break(cue):
    """말이 아닌 칸인지. 노래, 소리 설명, 빈 칸."""
    if MUSIC.search(cue):
        return True
    stripped = PAREN.sub(" ", BRACKET.sub(" ", TAG.sub(" ", cue)))
    return not re.search(r"[A-Za-z]", stripped)


def join_cues(cues):
    """자막은 한 문장을 두세 칸에 나눠 담는다. 이어 붙여 한 사람의 한 마디로 만든다.

    시트콤 대사는 짧다. 문장부호가 나오자마자 끊으면 "How are you?" 같은 것만 남아
    연습이 안 된다. 그래서 **문장부호로 끝나고 길이도 될 때까지** 이어 붙인다.
    화자가 바뀌면(빈 칸이 오면) 거기서 끊는다.
    """
    out = []
    buf = ""
    for cue in cues:
        # 노래 가사나 소리 설명은 말이 아니다. 여기서 끊지 않으면
        # 문장부호가 없어서 다음 사람의 말을 통째로 빨아들인다
        if is_break(cue):
            buf = ""
            continue
        one = clean_line(cue)
        if not one:
            buf = ""
            continue
        buf = (buf + " " + one).strip() if buf else one
        # 문장이 끝났으면 거기서 끊는다. 짧다고 다음 말까지 붙이면
        # 다른 사람의 말이 한 문장으로 섞인다 \u2014 그건 실제로 한 말이 아니게 된다
        if re.search(r'[.!?\u2026]["\u201d\')]?$', buf):
            out.append(buf)
            buf = ""
        elif len(buf.split()) > MAX_WORDS:
            buf = ""                                    # 끝없이 이어지면 버린다
    if buf:
        out.append(buf)
    return out


def usable(text):
    if not re.search(r'[.!?]["\u201d\')]?$', text):
        return False
    words = text.split()
    if len(words) < MIN_WORDS or len(words) > MAX_WORDS:
        return False
    if not re.search(r"[a-z]", text):                   # 전부 대문자면 자막 표시일 때가 많다
        return False
    if not re.search(r"[A-Za-z]", text):
        return False
    if CREDIT.search(text):                             # 자막 제작자 표시
        return False
    if text.count(":") > 1:
        return False
    return True


def title_of(path):
    name = os.path.splitext(os.path.basename(path))[0]
    name = re.sub(r"[._]+", " ", name)
    name = re.sub(r"\b(720p|1080p|2160p|x264|x265|hdtv|web-?dl|bluray|hevc|aac|"
                  r"webrip|dvdrip|proper|repack|internal|eng|english)\b", " ", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" -")
    return name or os.path.basename(path)


def judge(raw, cues, kept):
    """이 자막을 써도 되는지 판단해서 한국어로 알려 준다.

    운영자가 자막을 눈으로 보고 고르기는 어렵다. 도구가 대신 봐 준다.
    """
    if not cues:
        return "bad", "자막을 읽지 못했습니다. 파일이 깨졌거나 모양이 다릅니다."

    letters = len(re.findall(r"[A-Za-z]", raw))
    hangul = len(re.findall(r"[\uac00-\ud7a3]", raw))
    if hangul > letters:
        return "bad", "한국어 자막입니다. 영어 자막을 넣어 주세요."
    if letters < 500:
        return "bad", "글이 너무 적습니다. 자막 일부만 들어 있는 것 같습니다."

    stops = len(re.findall(r"[.!?]", raw))
    if stops < len(cues) * 0.15:
        return "bad", "문장부호가 거의 없습니다. 자동 생성 자막으로 보입니다 \u2014 연습에 못 씁니다."

    if not kept:
        return "bad", "쓸 만한 대사가 없습니다."
    if len(kept) < 20:
        return "weak", "쓸 만한 대사가 " + str(len(kept)) + "줄뿐입니다. 짧은 영상이거나 대사가 적습니다."
    return "ok", ""


def lines_from(path):
    raw = read_text(path)
    cues = cues_of(path, raw)
    joined = join_cues(cues)
    out, seen = [], set()
    for one in joined:
        if not usable(one):
            continue
        key = re.sub(r"[^a-z0-9 ]", "", one.lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        out.append(one)
    grade, why = judge(raw, cues, out)
    return out, grade, why


# ---------------------------------------------------------------- 고르기

def spread(by_source, limit, rng):
    """한 작품이 다 차지하지 않게 돌아가며 뽑는다."""
    pools = {}
    for src in by_source:
        pools[src] = by_source[src][:]
        rng.shuffle(pools[src])
    out, seen = [], set()
    names = sorted(pools.keys())
    while len(out) < limit:
        took = False
        for src in names:
            while pools[src]:
                text = pools[src].pop()
                key = re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()
                if key in seen:          # 다른 편에 같은 대사가 또 나올 수 있다
                    continue
                seen.add(key)
                out.append({"text": text, "source": src})
                took = True
                break
            if len(out) >= limit:
                break
        if not took:
            break
    return out


# ---------------------------------------------------------------- 실행

def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--profile", default=None)
    ap.add_argument("--lines", type=int, default=DEFAULT_LINES)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("-h", "--help", action="store_true")
    args = ap.parse_args()

    if args.help or not args.paths:
        print(__doc__)
        return

    if not args.dry_run:
        check_repo()

    files = find_files(args.paths)
    if not files:
        die("자막 파일을 찾지 못했습니다.\n"
            "  폴더 안에 .srt / .vtt / .smi 파일이 있는지 봐 주세요.")

    say(str(len(files)) + "개 자막 파일을 읽습니다.")
    say("")
    by_source = {}
    total = 0
    skipped = []
    for path in files:
        name = os.path.basename(path)
        try:
            got, grade, why = lines_from(path)
        except Exception as e:
            skipped.append((name, "읽지 못했습니다 (" + type(e).__name__ + ")"))
            continue
        if grade == "bad":
            skipped.append((name, why))
            continue
        src = title_of(path)
        by_source.setdefault(src, [])
        by_source[src].extend(got)
        total += len(got)
        say("  \u2713 " + src + " \u2014 " + str(len(got)) + "줄"
            + ("   (" + why + ")" if why else ""))

    if skipped:
        say("")
        say("쓰지 않은 파일:")
        for name, why in skipped:
            say("  \u2717 " + name)
            say("      " + why)

    if not total:
        die("쓸 만한 대사를 하나도 찾지 못했습니다.\n"
            "  위에 적힌 이유를 보고 다른 자막을 받아 주세요.\n"
            "  영어 자막이어야 하고, 자동 생성이 아닌 사람이 만든 것이어야 합니다.")

    rng = random.Random(args.seed)
    picked = spread(by_source, args.lines, rng)

    say("")
    say("모두 " + str(total) + "줄 중에서 " + str(len(picked)) + "줄을 골랐습니다.")
    for one in picked[:5]:
        say("  [" + one["source"] + "] " + one["text"])
    if len(picked) > 5:
        say("  ...")

    if args.dry_run:
        say("\n(시험 삼아 돌린 것이라 저장하지 않았습니다.)")
        return

    profile_id = ensure_profile(args.profile)
    out_dir = os.path.join(ROOT, "data", "shows", profile_id)
    out_path = os.path.join(out_dir, "pool.json")
    write_json(out_path, {
        "updatedAt": __import__("datetime").date.today().isoformat(),
        "sources": sorted(by_source.keys()),
        "lines": picked
    })

    git_sync()
    git_publish([os.path.relpath(out_path, ROOT)],
                "영상 대사 " + str(len(picked)) + "줄 (" + str(len(by_source)) + "개 작품)")

    say("")
    say("올렸습니다. 내일 아침부터 앱의 From your videos 탭에 이 대사들이 나옵니다.")
    say("(지금 바로 보고 싶으면 GitHub 의 Actions 에서 '하루 다섯 문장' 을 직접 돌리세요.)")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        die("중단했습니다.")
    except Exception as e:
        die("예상하지 못한 문제가 생겼습니다.\n"
            "  " + type(e).__name__ + ": " + str(e)[:300] + "\n\n"
            "이 화면을 그대로 알려 주시면 고치겠습니다.")
