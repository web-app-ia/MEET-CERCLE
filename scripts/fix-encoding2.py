#!/usr/bin/env python3
"""
Correctif d'encodage (passe 2) — granulaire.

Certaines lignes mélangent du mojibake et du texte UTF-8 déjà correct
(ellipses, flèches…). L'aller-retour ligne entière échoue alors. On découpe
donc chaque ligne en fragments maximaux encodables en Latin-1, et on ne
décode que ceux qui produisent un changement valide.

Un fragment déjà correct (« café ») échoue volontairement au décodage UTF-8
et est donc conservé tel quel : aucun risque de régression.
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
         "Ã®", "Ã‰", "Ãˆ", "Ã€", "Ã¢", "Ã»", "Ã¯", "Ã«", "Ã¼", "Ã±")

# Découpe : suites de caractères encodables en Latin-1 (donc candidats)
RUN_RE = re.compile(r"[\x00-\xff]+")


def fix_fragment(frag: str) -> str:
    """Tente de réparer un fragment mojibake. Renvoie l'original si échec."""
    if not any(m in frag for m in MARKS):
        return frag
    try:
        decoded = frag.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return frag
    return decoded if decoded != frag else frag


def fix_text(text: str) -> str:
    # On ne travaille que sur les lignes suspectes pour limiter le bruit.
    out = []
    for line in text.splitlines(keepends=True):
        if not any(m in line for m in MARKS):
            out.append(line)
            continue
        out.append(RUN_RE.sub(lambda m: fix_fragment(m.group(0)), line))
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
            print(f"  OK      {path}")
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
