#!/usr/bin/env python3
"""
CERCLE MEET — Purge les anciens systèmes d'en-tête et installe le composant unifié.

Anciens systèmes supprimés :
  - <header class="cm-header-unified"> ... </header>
  - <nav class="cm-nav"> ... </nav>
  - <header class="topbar"> ... </header>
  - les blocs <style> contenant l'ancien CSS .cm-nav / .cm-link / .cm-hidden

Puis insère <script src="/js/header.js"></script> juste après <body>.
"""

import re
import sys
from pathlib import Path

PUBLIC = Path("app/mirotalk/public")

# Fichiers à traiter : (chemin, insérer_le_script)
TARGETS = [
    ("views/landing.html", True),
    ("tarifs.html", True),
    ("abonnement.html", True),
    ("account.html", True),
    ("views/newcall.html", True),
    ("views/login.html", True),
    ("views/404.html", True),
    ("views/waitingRoom.html", True),
    ("views/customizeRoom.html", True),
    ("views/privacy.html", True),
    # Salle de réunion : on retire uniquement les blocs injectés par erreur,
    # sans installer l'en-tête de site (l'UI de réunion a son propre chrome).
    ("views/client.html", False),
]

BLOCK_PATTERNS = [
    re.compile(r"[ \t]*<header[^>]*cm-header-unified[^>]*>.*?</header>[ \t]*\n?", re.S),
    re.compile(r"[ \t]*<nav[^>]*class=\"cm-nav\"[^>]*>.*?</nav>[ \t]*\n?", re.S),
    re.compile(r"[ \t]*<header[^>]*class=\"topbar\"[^>]*>.*?</header>[ \t]*\n?", re.S),
]

# Bloc <style> ne contenant QUE l'ancienne nav (heuristique : présence de
# ".cm-nav {" et absence de sélecteurs métier connus).
STYLE_PATTERN = re.compile(r"[ \t]*<style[^>]*>.*?</style>[ \t]*\n?", re.S)
KEEP_MARKERS = (".cm-compare", ".cm-hero", ".cm-cta", ".cm-price", ".cm-plan")

SCRIPT_TAG = '<script src="/js/header.js"></script>'
BODY_RE = re.compile(r"(<body[^>]*>)", re.I)


def strip_old_blocks(html: str) -> tuple[str, int]:
    removed = 0
    for pat in BLOCK_PATTERNS:
        html, n = pat.subn("", html)
        removed += n

    def style_sub(m):
        nonlocal removed
        block = m.group(0)
        if ".cm-nav {" in block or ".cm-nav{" in block:
            if not any(k in block for k in KEEP_MARKERS):
                removed += 1
                return ""
        return block

    html = STYLE_PATTERN.sub(style_sub, html)
    return html, removed


def install(html: str) -> tuple[str, bool]:
    if "js/header.js" in html:
        return html, False
    return BODY_RE.sub(lambda m: m.group(1) + "\n" + SCRIPT_TAG, html, count=1), True


def main() -> int:
    changed = []
    for rel, do_install in TARGETS:
        path = PUBLIC / rel
        if not path.exists():
            print(f"  ABSENT  {rel}")
            continue

        original = path.read_text(encoding="utf-8", errors="replace")
        html = original

        html, removed = strip_old_blocks(html)
        installed = False
        if do_install:
            html, installed = install(html)

        if html != original:
            path.write_text(html, encoding="utf-8")
            print(f"  OK      {rel}  (blocs supprimés: {removed}, composant: "
                  f"{'installé' if installed else 'déjà présent/absent'})")
            changed.append(rel)
        else:
            print(f"  INCHANGE {rel}")

    print(f"\n{len(changed)} fichier(s) modifié(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
