#!/usr/bin/env python3
"""
Retire de landing.html :
  A) la section #compare (désormais une vraie page /comparer.html)
  B) l'ancien script de nav (Connexion/Déconnexion + toggle Comparer),
     désormais géré par /js/header.js

Travaille par index de lignes pour éviter tout problème d'encodage.
"""
from pathlib import Path

P = Path("app/mirotalk/public/views/landing.html")
lines = P.read_text(encoding="utf-8").splitlines(keepends=True)


def find(pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    return -1


# --- Vérification encodage -------------------------------------------------
sample = [l for l in lines if "compare" in l.lower()][:1]
print("Aperçu encodage (repr) :", repr(sample[0][:80]) if sample else "n/a")

# --- Bloc A : section #compare --------------------------------------------
a_start = find(lambda l: 'id="compare"' in l)
if a_start == -1:
    print("A: section #compare introuvable")
else:
    a_end = a_start
    while a_end < len(lines) and lines[a_end].strip() != "</section>":
        a_end += 1
    print(f"A: section #compare lignes {a_start+1}..{a_end+1}")
    del lines[a_start:a_end + 1]

# --- Bloc B : ancien script de nav ----------------------------------------
b_anchor = find(lambda l: "nav-compare" in l)
if b_anchor == -1:
    print("B: script de nav introuvable")
else:
    b_start = b_anchor
    while b_start > 0 and "<script" not in lines[b_start]:
        b_start -= 1
    # remonter jusqu'au commentaire qui précède éventuellement
    if b_start > 0 and lines[b_start - 1].strip().startswith("<!--"):
        b_start -= 1
    b_end = b_anchor
    while b_end < len(lines) and "</script>" not in lines[b_end]:
        b_end += 1
    print(f"B: script lignes {b_start+1}..{b_end+1}")
    del lines[b_start:b_end + 1]

P.write_text("".join(lines), encoding="utf-8")
print("landing.html mis à jour.")
