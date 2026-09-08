#!/usr/bin/env python3
"""
Corrige le double encodage UTF-8 (mojibake) des pages HTML.

Symptôme : « géants » a été lu comme Latin-1 puis réécrit en UTF-8, donnant
« gÃ©ants ». Les pages concernées affichaient donc « CERCLE MEET â€” Tarifs »
au lieu de « CERCLE MEET — Tarifs ».

Méthode : ligne par ligne, on tente l'aller-retour
    line.encode('latin-1').decode('utf-8')
Si la ligne contient du texte UTF-8 déjà correct, l'opération échoue et la
ligne est laissée intacte. Aucun risque de casser ce qui est déjà bon.
"""
from pathlib import Path

MARKS = ("â€", "Ã©", "Ã ", "Ã¨", "Ãª", "Ã´", "Ã¹", "Ã§", "Ã\xa0", "Ã»", "Ã®")

ROOT = Path("app/mirotalk/public")
TARGETS = [
    ROOT / "views" / "landing.html",
    ROOT / "abonnement.html",
    ROOT / "tarifs.html",
    ROOT / "views" / "client.html",
]


def fix_line(line: str) -> tuple[str, bool]:
    if not any(m in line for m in MARKS):
        return line, False
    try:
        return line.encode("latin-1").decode("utf-8"), True
    except (UnicodeEncodeError, UnicodeDecodeError):
        return line, False


def main() -> None:
    total = 0
    for path in TARGETS:
        if not path.exists():
            print(f"  ABSENT {path}")
            continue
        text = path.read_text(encoding="utf-8")
        out, n = [], 0
        for line in text.splitlines(keepends=True):
            new, changed = fix_line(line)
            if changed:
                n += 1
            out.append(new)
        if n:
            path.write_text("".join(out), encoding="utf-8")
            print(f"  OK      {path}  ({n} lignes corrigées)")
        else:
            print(f"  INCHANGE {path}")
        total += n
    print(f"\n{total} ligne(s) corrigées au total.")

    # Contrôle : plus aucun marqueur ne doit subsister.
    print("\n--- contrôle final ---")
    rest = 0
    for path in TARGETS:
        if path.exists():
            c = sum(path.read_text(encoding="utf-8").count(m) for m in MARKS)
            if c:
                print(f"  RESTE {c} dans {path}")
            rest += c
    print("Aucun résidu." if rest == 0 else f"{rest} résidu(s).")


if __name__ == "__main__":
    main()
