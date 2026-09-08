#!/usr/bin/env python3
"""
Correctif d'encodage (passe 3) — le bon codec.

Diagnostic : les octets UTF-8 ont été décodés en **Windows-1252** (cp1252),
pas en Latin-1. La preuve : la séquence de l'em-dash (E2 80 94) apparaît
comme « â€» — le '€' (U+20AC) est la lecture cp1252 de l'octet 0x80.
Latin-1 échoue donc sur ces fragments, d'où les résidus des passes 1-2.

Réparation : fragment.encode('cp1252').decode('utf-8').
"""
from pathlib import Path
import re

ROOT = Path("app/mirotalk/public")
TARGETS = [
    ROOT / "views" / "landing.html",
    ROOT / "abonnement.html",
    ROOT / "tarifs.html",
    ROOT / "views" / "client.html",
]

MARKS = ("â€", "Ã©", "Ã ", "Ã¨", "Ãª", "Ã´", "Ã¹", "Ã§", "Ã\xa0", "Ã»",
         "Ã®", "Ã‰", "Ãˆ", "Ã€", "Ã¢", "Ã¯", "Ã«", "Ã¼", "Ã±", "Ã»")

# Ensemble exact des caractères représentables en cp1252 (le codec a des
# octets non définis : on les ignore proprement).
CP_OK = set()
for _b in range(256):
    try:
        CP_OK.add(bytes([_b]).decode("cp1252"))
    except UnicodeDecodeError:
        pass


def fix_fragment(frag: str) -> str:
    try:
        decoded = frag.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return frag
    return decoded if decoded != frag else frag


def fix_line(line: str) -> str:
    """Regroupe les caractères cp1252-encodables et tente de les réparer."""
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
        if not any(m in line for m in MARKS):
            out.append(line)
            continue
        out.append(fix_line(line))
    return "".join(out)


def main() -> None:
    for path in TARGETS:
        if not path.exists():
            print(f"  ABSENT {path}")
            continue
        before = path.read_text(encoding="utf-8")
        after = fix_text(before)
        if after != before:
            path.write_text(after, encoding="utf-8")
            print(f"  OK       {path}")
        else:
            print(f"  INCHANGE {path}")

    print("\n--- contrôle final ---")
    rest = 0
    for path in TARGETS:
        if not path.exists():
            continue
        c = sum(path.read_text(encoding="utf-8").count(m) for m in MARKS)
        print(f"  {c:>3} marqueur(s)  {path}")
        rest += c
    print("\nAucun résidu." if rest == 0 else f"\n{rest} résidu(s) restant(s).")


if __name__ == "__main__":
    main()
