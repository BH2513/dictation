#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""영상 등록 스크립트 — SPEC 8.

유튜브 영상의 자막을 받아 문장 단위로 잘라 /data/videos/{profileId}/ 에 넣고,
git commit / push 까지 한다.

    python tools/add_video.py "유튜브URL" --profile 이름
"""

import argparse
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import date

# SPEC 8 문장 분할 규칙의 기준값
GAP_SEC = 0.8       # 줄 간 무음이 이 이상이면 경계
WORD_SEC = 0.28     # 시각이 없는 단어 하나가 차지한다고 보는 시간
MAX_DUR = 15.0      # 한 문장 최대 길이(초)
MAX_WORDS = 25      # 한 문장 최대 단어 수

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

PALETTE = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ec4899", "#14b8a6"]


# ---------------------------------------------------------------- 유틸

def die(msg):
    print("\n[중단] " + msg + "\n", file=sys.stderr)
    sys.exit(1)


def say(msg):
    print(msg, flush=True)


def extract_video_id(raw):
    """순수 ID, watch?v=, youtu.be/, /embed/, /shorts/, /live/ 를 모두 받는다."""
    s = (raw or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    for pat in (r"[?&]v=([A-Za-z0-9_-]{11})",
                r"youtu\.be/([A-Za-z0-9_-]{11})",
                r"/embed/([A-Za-z0-9_-]{11})",
                r"/shorts/([A-Za-z0-9_-]{11})",
                r"/live/([A-Za-z0-9_-]{11})"):
        m = re.search(pat, s)
        if m:
            return m.group(1)
    return ""


# ---------------------------------------------------------------- VTT 읽기

TIME_TAG = re.compile(r"<(\d{1,2}:\d{2}:\d{2}\.\d{3})>")
ANY_TAG = re.compile(r"<[^>]*>")
CUE_LINE = re.compile(r"^\s*([\d:.]+)\s*-->\s*([\d:.]+)(.*)$")


def parse_ts(s):
    parts = s.strip().split(":")
    if len(parts) == 3:
        h, m, rest = parts
    elif len(parts) == 2:
        h, m, rest = "0", parts[0], parts[1]
    else:
        raise ValueError("시각 형식을 읽을 수 없음: " + s)
    sec, _, ms = rest.partition(".")
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms or 0) / 1000.0


NOISE = re.compile(r"\[[^\]]*\]")          # [applause], [Music] 같은 소리 표시
BREAK = "\u2016"                          # 말이 아닌 구간이라는 표시. 문장 경계로 쓰고 글자에서는 뺀다


def clean(text):
    """태그를 걷어내고 공백을 정리한다.

    소리 표시는 그냥 지우면 안 된다. 박수 구간이 통째로 사라지면 그 앞뒤 문장이
    맞붙어 버린다. 자리에 경계 표시를 남겨 둔다.
    """
    t = html.unescape(ANY_TAG.sub("", text))
    t = NOISE.sub(" " + BREAK + " ", t)
    return re.sub(r"\s+", " ", t).strip()


def parse_vtt(raw):
    """VTT를 [{start, end, payload, text}] 로. payload 는 태그를 남겨 둔 원본."""
    cues = []
    block = None
    for line in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        m = CUE_LINE.match(line)
        if m and "-->" in line:
            block = {"start": parse_ts(m.group(1)), "end": parse_ts(m.group(2)), "lines": []}
            cues.append(block)
            continue
        if block is not None:
            # VTT 에서 조각을 끝내는 것은 **완전히 빈 줄**이다.
            # 공백 한 칸짜리 줄을 끝으로 보면 그 뒤 내용을 통째로 잃는다.
            # 유튜브 자동자막은 실제로 그런 줄을 넣는다.
            if line == "":
                block = None
            else:
                block["lines"].append(line)
    out = []
    for c in cues:
        payload = "\n".join(c["lines"])
        text = clean(payload)
        if text:
            out.append({"start": c["start"], "end": c["end"], "payload": payload, "text": text})
    return out


def words_from_cues(cues):
    """자동생성 자막의 단어별 시각을 뽑는다.

    유튜브 자동자막은 앞 큐에 나온 줄을 다음 큐 앞부분에 다시 실어 보낸다.
    이미 내보낸 단어들의 끝과 겹치는 만큼을 잘라내고 나머지를 새 단어로 본다.

    그 새 단어들에는 시각 표시가 붙어 있지 않다. 여기에 큐가 뜬 시각을 주면 안 된다 —
    자막 한 줄은 그 줄이 다 말해진 뒤에 화면에 뜨므로, 시각 없는 앞부분 단어들은
    큐가 뜨기 **전에** 말해진 것이다. 그렇게 주면 문장 앞부분이 통째로 잘려 들린다.
    큐 시작에서 단어 수만큼 거슬러 올라가 놓는다.
    """
    words = []
    for c in cues:
        parts = TIME_TAG.split(c["payload"])
        t = c["start"]
        for i, chunk in enumerate(parts):
            if i % 2 == 1:
                t = parse_ts(chunk)
                continue
            new = clean(chunk).split()
            if not new:
                continue

            if i == 0:
                if words:
                    seen = [x["w"] for x in words]
                    overlap = 0
                    for k in range(min(len(new), len(seen)), 0, -1):
                        if new[:k] == seen[-k:]:
                            overlap = k
                            break
                    new = new[overlap:]
                if not new:
                    continue
                times = lead_times(new, c["start"], words[-1]["t"] if words else None)
                for j in range(len(new)):
                    words.append({"t": times[j], "w": new[j], "cue_end": c["end"]})
                continue

            for w in new:
                words.append({"t": t, "w": w, "cue_end": c["end"]})
    return words


def lead_times(new, cue_start, prev_t):
    """시각 표시가 없는 단어들에 시각을 매긴다.

    맨 처음 큐라면 큐 시작에서부터 앞으로 놓고,
    그 밖에는 큐 시작 직전에 닿도록 뒤에서부터 거슬러 놓는다.
    앞 단어보다 앞서지 않도록 막는다.
    """
    n = len(new)
    if prev_t is None:
        return [round(cue_start + j * WORD_SEC, 3) for j in range(n)]
    out = []
    for j in range(n):
        tm = cue_start - (n - j) * WORD_SEC
        if tm <= prev_t:
            tm = prev_t + 0.01 * (j + 1)
        out.append(round(max(tm, 0.0), 3))
    return out


def units_from_words(words, last_end):
    """단어 목록을 분할 함수가 쓰는 단위로 바꾼다.

    단어의 끝은 다음 단어가 시작하는 때. 다만 자기가 속한 자막 조각의 끝을 넘지 않는다.
    넘게 두면 말이 끊긴 구간까지 앞 단어가 물고 있어서 무음 규칙이 걸리지 않는다.
    """
    units = []
    for i, x in enumerate(words):
        end = words[i + 1]["t"] if i + 1 < len(words) else last_end
        end = min(end, x.get("cue_end", end))
        if end <= x["t"]:
            end = x["t"] + 0.3
        units.append({"start": x["t"], "end": end, "text": x["w"]})
    return units


# ---------------------------------------------------------------- 문장 분할

ENDS_SENTENCE = re.compile(r"[.?!][\"')\]]*$")
CONTINUES = ('，', ',', ':', ';', '-', '—', '–')
I_WORDS = {"I", "I'm", "I've", "I'll", "I'd", "I."}


def ends_sentence(prev_text):
    """SPEC 8: 앞줄이 . ? ! 로 끝나면 문장 종료."""
    return bool(ENDS_SENTENCE.search(prev_text.rstrip()))


def starts_capital(prev_text, text):
    """SPEC 8: 다음 줄이 대문자로 시작하면 경계.

    그대로 쓰면 문장 중간의 'I'나 쉼표 뒤 줄바꿈에서도 잘린다. 그 둘은 예외로 둔다.
    """
    prev = prev_text.rstrip()
    first = text.strip().split(" ")[0] if text.strip() else ""
    if not first or not first[0].isupper():
        return False
    if prev.endswith(CONTINUES):
        return False
    if first.strip(",.") in I_WORDS or first in I_WORDS:
        return False
    return True


def looks_punctuated(text):
    """자막에 문장부호가 실제로 들어 있는지 본다.

    유튜브 자동자막은 예전엔 구두점이 없었지만 지금은 넣어 준다.
    있는데도 안 쓰면 무음 간격에만 기대게 되어 문장이 25단어마다 잘린다.
    """
    words = len(text.split())
    if words < 20:
        return False
    return len(re.findall(r"[.?!]", text)) / words >= 0.02


def mark_speakers(units):
    """'>>' 는 말하는 사람이 바뀌었다는 표시, BREAK 는 말이 아닌 구간.

    둘 다 문장 경계로 쓰고 글자에서는 지운다.
    """
    out, pending = [], False
    for u in units:
        raw = u["text"]
        text = raw.replace(">>", " ").replace(BREAK, " ").strip()
        text = re.sub(r"\s+", " ", text)
        if not text:
            if ">>" in raw or BREAK in raw:
                pending = True
            continue
        item = dict(u, text=text)
        if ">>" in raw or BREAK in raw or pending:
            item["speaker"] = True
            pending = False
        out.append(item)
    return out


def count_words(units):
    return sum(len(u["text"].split()) for u in units)


def split_sentences(units, use_punct=True, use_capital=True,
                    gap=GAP_SEC, max_dur=MAX_DUR, max_words=MAX_WORDS):
    """단위 목록을 문장 덩어리로 나눈다. SPEC 8.

    무음 간격과 강제 분할은 언제나 적용한다.
    구두점 규칙은 자막에 문장부호가 있을 때만, 대문자 규칙은 줄 단위 자막에만 쓴다.
    (단어 단위로 쪼갠 자동자막에 대문자 규칙을 쓰면 이름마다 문장이 끊긴다.)
    """
    units = mark_speakers(units)
    out, cur = [], []
    for u in units:
        if cur:
            prev = cur[-1]
            boundary = (u["start"] - prev["end"]) >= gap or u.get("speaker", False)
            if not boundary and use_punct:
                boundary = ends_sentence(prev["text"])
            if not boundary and use_capital:
                boundary = starts_capital(prev["text"], u["text"])
            if not boundary:
                too_long = (u["end"] - cur[0]["start"]) > max_dur
                too_many = (count_words(cur) + len(u["text"].split())) > max_words
                boundary = too_long or too_many
            if boundary:
                out.append(cur)
                cur = []
        cur.append(u)
    if cur:
        out.append(cur)
    return out


def to_sentences(groups):
    res = []
    for i, g in enumerate(groups):
        text = re.sub(r"\s+", " ", " ".join(u["text"] for u in g)).strip()
        if not text:
            continue
        res.append({
            "i": len(res),
            "start": round(g[0]["start"], 3),
            "end": round(g[-1]["end"], 3),
            "text": text,
            "recording": None,
        })
    return res


def attach_korean(sentences, ko_cues, min_overlap=0.4):
    """한국어 자막을 시간이 겹치는 문장에 붙인다."""
    for s in sentences:
        picked = []
        for c in ko_cues:
            dur = max(c["end"] - c["start"], 0.001)
            overlap = min(s["end"], c["end"]) - max(s["start"], c["start"])
            if overlap / dur >= min_overlap:
                if not picked or picked[-1] != c["text"]:
                    picked.append(c["text"])
        if picked:
            s["ko"] = " ".join(picked)
    # 필드 순서를 SPEC 4-1 과 맞춘다
    ordered = []
    for s in sentences:
        o = {"i": s["i"], "start": s["start"], "end": s["end"], "text": s["text"]}
        if "ko" in s:
            o["ko"] = s["ko"]
        o["recording"] = s["recording"]
        ordered.append(o)
    return ordered


# ---------------------------------------------------------------- yt-dlp

# 유튜브가 짧은 시간에 여러 번 부르면 막는다(429). 요청 사이를 띄우고 재시도한다.
GENTLE = ["--retries", "10", "--sleep-requests", "1", "--no-warnings"]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", **kw)


def rate_limited(err):
    return "429" in (err or "") or "Too Many Requests" in (err or "")


def busy_message():
    return ("유튜브가 잠시 요청을 막았습니다.\n"
            "5~10분 뒤에 같은 명령을 다시 실행해 주세요. 기다리는 것 말고 할 일은 없습니다.")


def ytdlp_info(url):
    say("영상 정보를 확인하는 중…")
    r = run(["yt-dlp", "-J", "--skip-download"] + GENTLE + [url])
    if r.returncode != 0:
        if rate_limited(r.stderr):
            die(busy_message())
        die("유튜브에서 영상 정보를 가져오지 못했습니다.\n"
            "인터넷 연결과 주소를 확인해 주세요.\n\n" + (r.stderr or "").strip()[:800])
    return json.loads(r.stdout)


def is_translated(entries):
    """유튜브는 자동자막을 100개 언어로 기계번역해서 함께 내놓는다.

    그 번역본은 원문이 아니라 자동자막을 한 번 더 기계에 넣은 것이라
    받아쓰기 교재로 쓸 수 없다. 주소에 tlang 이 붙어 있으면 번역본이다.
    """
    for e in entries or []:
        if "tlang=" in (e.get("url") or ""):
            return True
    return False


def pick_korean(manual, auto):
    """직접 단 한국어를 우선. 자동자막은 기계번역본이면 쓰지 않는다."""
    code = pick_lang(manual, ["ko"])
    if code:
        return code, False
    code = pick_lang(auto, ["ko"])
    if code and not is_translated((auto or {}).get(code)):
        return code, True
    return None, False


def pick_lang(table, prefixes):
    if not table:
        return None
    for want in prefixes:
        for code in table:
            if code == want:
                return code
    for want in prefixes:
        for code in sorted(table):
            if code.split("-")[0] == want:
                return code
    return None


def download_subs(url, lang, auto, tmpdir, required=True):
    """자막 하나를 받아 문자열로 돌려준다. required=False 면 실패해도 None."""
    flag = "--write-auto-subs" if auto else "--write-subs"
    r = run(["yt-dlp", "--skip-download", flag, "--sub-langs", lang,
             "--sub-format", "vtt/best", "--convert-subs", "vtt"] + GENTLE +
            ["-o", os.path.join(tmpdir, "%(id)s"), url])
    if r.returncode != 0:
        if not required:
            return None
        if rate_limited(r.stderr):
            die(busy_message())
        die("자막을 내려받지 못했습니다.\n\n" + (r.stderr or "").strip()[:800])
    files = [f for f in os.listdir(tmpdir) if f.endswith(".vtt")]
    if not files:
        return None
    files.sort(key=lambda f: (lang not in f, f))
    with open(os.path.join(tmpdir, files[0]), encoding="utf-8") as fh:
        return fh.read()


# ---------------------------------------------------------------- 저장소 파일

def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def ensure_profile(name):
    """이름으로 프로필을 찾고 없으면 만든다. id 는 주소에 들어가므로 영문으로 둔다."""
    path = os.path.join(DATA, "profiles.json")
    profiles = read_json(path, [])
    key = name.strip().casefold()
    for p in profiles:
        if p["name"].strip().casefold() == key:
            return p, profiles, False
    new = {
        "id": "p%d" % (len(profiles) + 1),
        "name": name.strip(),
        "color": PALETTE[len(profiles) % len(PALETTE)],
    }
    profiles.append(new)
    write_json(path, profiles)
    return new, profiles, True


def update_index(profile_id, entry):
    path = os.path.join(DATA, "videos", profile_id, "index.json")
    items = [x for x in read_json(path, []) if x.get("videoId") != entry["videoId"]]
    items.append(entry)
    items.sort(key=lambda x: x.get("addedAt", ""), reverse=True)
    write_json(path, items)


def rejected(err):
    """원격에 내가 아직 받지 않은 변경이 있어서 밀린 경우."""
    e = err or ""
    return "fetch first" in e or "non-fast-forward" in e or "[rejected]" in e


def git_sync():
    """올리기 전에 원격의 변경을 먼저 받는다.

    앱 쪽 수정이 GitHub 에서 계속 올라오므로 이 저장소는 대개 뒤처져 있다.
    그대로 push 하면 거절당한다 — 인터넷 문제가 아니다.
    """
    r = run(["git", "-C", ROOT, "pull", "--rebase"])
    if r.returncode != 0:
        die("저장소를 최신 상태로 맞추지 못했습니다.\n"
            "아래를 차례로 실행한 뒤 등록을 다시 해 주세요.\n\n"
            "    git rebase --abort\n"
            "    git pull\n\n" + ((r.stderr or "") + (r.stdout or "")).strip()[:600])


def git_publish(paths, message):
    r = run(["git", "-C", ROOT, "add"] + paths)
    if r.returncode != 0:
        die("git add 에 실패했습니다.\n" + r.stderr)
    r = run(["git", "-C", ROOT, "commit", "-m", message])
    if r.returncode != 0 and "nothing to commit" not in (r.stdout + r.stderr):
        die("git commit 에 실패했습니다.\n" + r.stdout + r.stderr)

    say("올리는 중…")
    git_sync()
    for attempt in range(4):
        r = run(["git", "-C", ROOT, "push"])
        if r.returncode == 0:
            return True
        err = (r.stderr or "") + (r.stdout or "")
        if rejected(err):
            # 우리가 올리는 사이에 또 뭔가 올라온 경우. 다시 받아서 시도한다.
            git_sync()
            continue
        if attempt < 3:
            import time
            time.sleep(2 ** (attempt + 1))
    die("올리지 못했습니다. 인터넷 연결을 확인하고 등록을 다시 해 주세요.\n\n"
        + ((r.stderr or "") + (r.stdout or "")).strip()[:600])


# ---------------------------------------------------------------- 본체

def main():
    ap = argparse.ArgumentParser(description="유튜브 영상을 받아쓰기 목록에 등록합니다.")
    ap.add_argument("url", help="유튜브 주소 또는 영상 ID")
    ap.add_argument("--profile", required=True, help="누구의 목록에 넣을지 (이름)")
    ap.add_argument("--no-git", action="store_true", help="파일만 만들고 올리지는 않음")
    ap.add_argument("--subs-file", help="영어 자막 파일을 직접 지정 (유튜브 대신)")
    ap.add_argument("--ko-subs-file", help="한국어 자막 파일을 직접 지정")
    ap.add_argument("--title", help="영상 제목을 직접 지정")
    args = ap.parse_args()

    video_id = extract_video_id(args.url)
    if not video_id:
        die("유튜브 주소를 알아볼 수 없습니다. 주소를 그대로 복사해 붙여넣어 주세요.")

    offline = bool(args.subs_file)
    title = args.title or ""
    source = "manual_captions"

    if offline:
        with open(args.subs_file, encoding="utf-8") as fh:
            en_raw = fh.read()
        ko_raw = None
        if args.ko_subs_file:
            with open(args.ko_subs_file, encoding="utf-8") as fh:
                ko_raw = fh.read()
        if not title:
            title = video_id
        if "Kind: asr" in en_raw or TIME_TAG.search(en_raw or ""):
            source = "auto_captions"
    else:
        info = ytdlp_info("https://www.youtube.com/watch?v=" + video_id)
        title = title or info.get("title") or video_id
        manual = info.get("subtitles") or {}
        auto = info.get("automatic_captions") or {}

        en = pick_lang(manual, ["en"])
        use_auto = False
        if not en:
            en = pick_lang(auto, ["en"])
            use_auto = True
        if not en:
            die("이 영상에는 영어 자막이 없습니다. 자막이 있는 영상으로 시도해 주세요.")
        source = "auto_captions" if use_auto else "manual_captions"
        say("자막을 받는 중… (%s, %s)" % (en, "자동생성" if use_auto else "직접 단 자막"))

        with tempfile.TemporaryDirectory() as tmp:
            en_raw = download_subs("https://www.youtube.com/watch?v=" + video_id, en, use_auto, tmp)
        if not en_raw:
            die("자막 파일을 받지 못했습니다.")

        ko_raw = None
        ko, ko_auto = pick_korean(manual, auto)
        if ko:
            say("한국어 자막도 받는 중…")
            with tempfile.TemporaryDirectory() as tmp:
                ko_raw = download_subs("https://www.youtube.com/watch?v=" + video_id,
                                       ko, ko_auto, tmp, required=False)
            if ko_raw is None:
                say("한국어 자막은 받지 못했습니다. 영어만으로 등록합니다.")

    cues = parse_vtt(en_raw)
    if not cues:
        die("자막에서 읽을 내용이 없습니다.")

    whole = " ".join(c["text"] for c in cues)
    punctuated = looks_punctuated(whole)

    if source == "auto_captions" and TIME_TAG.search(en_raw):
        # 자동자막은 같은 줄을 반복하므로 단어 단위로 풀어서 다룬다
        units = units_from_words(words_from_cues(cues), cues[-1]["end"])
        groups = split_sentences(units, use_punct=punctuated, use_capital=False)
    else:
        units = [{"start": c["start"], "end": c["end"], "text": c["text"]} for c in cues]
        groups = split_sentences(units, use_punct=punctuated,
                                 use_capital=(source == "manual_captions"))

    sentences = to_sentences(groups)
    ko_cues = parse_vtt(ko_raw) if ko_raw else []
    sentences = attach_korean(sentences, ko_cues)
    has_ko = any("ko" in s for s in sentences)

    profile, _, created = ensure_profile(args.profile)
    if created:
        say("'%s' 프로필을 새로 만들었습니다." % profile["name"])

    video_path = os.path.join(DATA, "videos", profile["id"], video_id + ".json")
    write_json(video_path, {
        "videoId": video_id,
        "title": title,
        "source": source,
        "sentences": sentences,
    })
    update_index(profile["id"], {
        "videoId": video_id,
        "title": title,
        "addedAt": date.today().isoformat(),
        "sentenceCount": len(sentences),
        "hasKorean": has_ko,
        "source": source,
    })

    say("")
    say("제목      : %s" % title)
    say("문장      : %d개" % len(sentences))
    if source == "auto_captions":
        kind = "자동생성 (문장부호 있음)" if punctuated else "자동생성 (경계가 부정확할 수 있음)"
    else:
        kind = "직접 단 자막"
    say("자막 종류 : %s" % kind)
    say("한국어    : %s" % ("있음" if has_ko else "없음"))
    say("목록      : %s" % profile["name"])

    if args.no_git:
        say("\n파일만 만들었습니다. 아직 올리지 않았습니다.")
        return

    git_publish(["data"], "영상 등록: %s (%s)" % (title, video_id))
    say("\n올렸습니다. 1~2분 뒤 사이트에서 보입니다.")


if __name__ == "__main__":
    main()
