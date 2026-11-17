#!/usr/bin/env python3
"""Checks the translations in web/i18n/*.js against the strings used in the code.

The source language is Portuguese: every user-visible string is a T("…") call in web/*.js,
a data-i18n* attribute in web/index.html or an L(@"…") / Lf(@"…") call in src/main.m.
This script lists, per language, the keys that are missing or unused and the translations whose
{placeholders} or HTML tags differ from the key.

    python3 scripts/i18n_check.py            # report
    python3 scripts/i18n_check.py --keys     # also print every key (JSON) to stdout
"""
import glob, html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def source_keys():
    keys = set()
    for f in glob.glob(f"{ROOT}/web/*.js"):
        for m in re.finditer(r'\bT\("((?:[^"\\]|\\.)*)"', open(f, encoding="utf-8").read()):
            keys.add(json.loads(f'"{m.group(1)}"'))
    for m in re.finditer(r'data-i18n(?:-html|-title|-ph)?="([^"]*)"', open(f"{ROOT}/web/index.html", encoding="utf-8").read()):
        keys.add(html.unescape(m.group(1)))
    for m in re.finditer(r'\bLf?\(@"((?:[^"\\]|\\.)*)"', open(f"{ROOT}/src/main.m", encoding="utf-8").read()):
        keys.add(json.loads(f'"{m.group(1)}"'))
    return keys


def load(path):
    s = open(path, encoding="utf-8").read()
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


def main():
    keys = source_keys()
    if "--keys" in sys.argv:
        print(json.dumps(sorted(keys), ensure_ascii=False, indent=1))
    placeholders = lambda s: sorted(re.findall(r"\{\w+\}", s))
    tags = lambda s: sorted(re.findall(r"</?\w+[^>]*>", s))
    ok = True
    print(f"{len(keys)} keys in the source", file=sys.stderr)
    for path in sorted(glob.glob(f"{ROOT}/web/i18n/*.js")):
        code, d = os.path.basename(path)[:-3], load(path)
        missing = sorted(k for k in keys if not d.get(k))
        unused = sorted(k for k in d if k not in keys)
        bad = sorted(k for k in keys if d.get(k) and (placeholders(k) != placeholders(d[k]) or tags(k) != tags(d[k])))
        print(f"{code}: {len(missing)} missing, {len(unused)} unused, {len(bad)} with wrong placeholders/tags", file=sys.stderr)
        for label, items in (("missing", missing), ("unused", unused), ("wrong", bad)):
            for k in items:
                print(f"   {label}: {k}", file=sys.stderr)
        ok = ok and not missing and not bad
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
