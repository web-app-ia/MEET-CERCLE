#!/usr/bin/env python3
"""Corrige le mojibake cp1252 dans les pages du portail /frontend."""
from pathlib import Path

ROOT = Path("frontend")
FILES = list(ROOT.rglob("*.html"))

MAP = {
    'â€”': '—', 'â€“': '–', 'â€¦': '…',
    'Ã©': 'é', 'Ã‰': 'É', 'Ã¨': 'è', 'Ãª': 'ê', 'Ã«': 'ë',
    'Ã ': 'à', 'Ã¢': 'â', 'Ã€': 'À',
    'Ã®': 'î', 'Ã¯': 'ï', 'Ã´': 'ô', 'Ã»': 'û', 'Ã¹': 'ù',
    'Ã§': 'ç', 'Ã¼': 'ü',
}
MARKS = tuple(MAP.keys())

CP_OK = set()
for _b in range(256):
    try:
        CP_OK.add(bytes([_b]).decode("cp1252"))
    except UnicodeDecodeError:
        pass


def fix_fragment(frag: str) -> str:
    try:
        return frag.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return frag


def fix_line(line: str) -> str:
    out, run = [], []

    def flush():
        if run:
            frag = "".join(run)
            out.append(fix_fragment(frag) if any(m in frag for m in MARKS) else frag)
            run.clear()

    for ch in line:
        if ch in CP_OK:
            run.append(ch)
        else:
            flush()
            out.append(ch)
    flush()
    return "".join(out)


def fix_text(text: str) -> str:
    out = []
    for line in text.splitlines(keepends=True):
        if any(m in line for m in MARKS):
            out.append(fix_line(line))
        else:
            out.append(line)
    t = "".join(out)
    for bad, good in MAP.items():
        if bad in t:
            t = t.replace(bad, good)
    return t


def main() -> None:
    for p in FILES:
        before = p.read_text(encoding="utf-8")
        after = fix_text(before)
        if after != before:
            p.write_text(after, encoding="utf-8")
            print(f"  OK      {p}")
        else:
            print(f"  INCHANGE {p}")
    print("--- controle ---")
    rest = 0
    for p in FILES:
        c = sum(p.read_text(encoding="utf-8").count(m) for m in MARKS)
        rest += c
    print("AUCUN RESIDU." if rest == 0 else f"{rest} residu(s).")


if __name__ == "__main__":
    main()
