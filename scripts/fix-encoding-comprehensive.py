#!/usr/bin/env python3
"""
CERCLE MEET — Correction exhaustive du mojibake cp1252 (double encodage).

Le bug : du texte UTF-8 a été lu comme cp1252 puis ré-enregistré en UTF-8.
Ex. "œ" (U+0153) -> bytes C5 93 lus en cp1252 -> "Å"", puis ré-encodé.

Cette passe reconstruit la table de correspondance mojibake->correct pour
tous les caractères des plages utiles (Latin-1, Latin étendu A, ponctuation
française, €, etc.) en calculant la forme mojibake = utf8(c).decode('cp1252').
Puis elle remplace par simple sous-chaîne (insensible à la ponctuation
voisine), ce que la méthode par "fragment" ne permettait pas.

Usage : python scripts/fix-encoding-comprehensive.py [chemin...]
Sans argument : traite frontend/*.html et app/mirotalk/public (+ views).
"""
import sys
from pathlib import Path

# Plages de codepoints à couvrir (français + ponctuation courante).
RANGES = [
    range(0x80, 0x100),       # Latin-1 / cp1252 spécial
    range(0x100, 0x180),      # Latin étendu A (Œ œ, À-ÿ, etc.)
    range(0x2000, 0x2070),    # ponctuation générale (– — … " " ' ')
    range(0x2018, 0x2020),    # guillemets typographiques
]
EXTRA = [0x20AC, 0x2122, 0x00A0, 0x00B0, 0x00B5, 0x0152, 0x0153]


def build_map():
    m = {}
    seen = set()
    for r in RANGES:
        for c in r:
            if c in seen:
                continue
            seen.add(c)
            _add(m, c)
    for c in EXTRA:
        if c not in seen:
            seen.add(c)
            _add(m, c)
    # Tri par longueur décroissante : les séquences les plus longues d'abord
    # (ex. "â€" " avant "â€").
    return dict(sorted(m.items(), key=lambda kv: len(kv[0]), reverse=True))


def _add(m, c):
    ch = chr(c)
    try:
        moji = ch.encode("utf-8").decode("cp1252")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return
    if moji and moji != ch:
        m[moji] = ch


def fix_file(path: Path, m: dict):
    text = path.read_text(encoding="utf-8")
    original = text
    hits = {}
    for bad, good in m.items():
        if bad in text:
            n = text.count(bad)
            hits[bad] = n
            text = text.replace(bad, good)
    if text != original:
        path.write_text(text, encoding="utf-8")
        tags = ", ".join(f"{k!r}->{M[k]!r}({n})" for k, n in hits.items())
        print(f"  OK      {path.relative_to(ROOT)}  [{tags}]")
        return True
    return False


# Témoins de mojibake restant après passage.
TELL = ["Ã", "Å", "â€", "Â\xa0", "Â", "Ã©", "Ã¨", "Ã®", "Ã´", "Ã¹", "Å\"", "�"]


def scan_leftovers(path: Path):
    text = path.read_text(encoding="utf-8")
    found = [t for t in TELL if t in text]
    return found


if __name__ == "__main__":
    M = build_map()
    ROOT = Path(".")
    if len(sys.argv) > 1:
        targets = [Path(a) for a in sys.argv[1:]]
    else:
        targets = []
        targets += list(Path("frontend").glob("*.html"))
        targets += list(Path("app/mirotalk/public").glob("*.html"))
        targets += list(Path("app/mirotalk/public/views").glob("*.html"))

    print(f"MAP size: {len(M)} entrées")
    changed = 0
    for p in targets:
        if p.exists():
            if fix_file(p, M):
                changed += 1
    print(f"{changed} fichier(s) corrigé(s).")

    print("--- contrôle résidus ---")
    total = 0
    for p in targets:
        if p.exists():
            left = scan_leftovers(p)
            if left:
                total += len(left)
                print(f"  RESIDU  {p.relative_to(ROOT)} -> {left}")
    print("AUCUN RESIDU." if total == 0 else f"{total} témoin(s) restant(s).")
