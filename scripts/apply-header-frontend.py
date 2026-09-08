#!/usr/bin/env python3
"""
CERCLE MEET — Portail /frontend : purge les anciens en-têtes et installe le
composant unifié header.js (version portail, servie depuis /assets/js/header.js).

Supprime :
  - <header class="cm-header-unified"> ... </header>
  - <header class="topbar"> ... </header>  (account.html)
  - <nav class="cm-nav-unified"> ... </nav>  (au cas où, hors header)
  - <section ... id="compare" ...> ... </section>  (index.html uniquement)
  - <style> ne contenant QUE le CSS .cm-compare / .cm-table-wrap

Puis insère <script src="/assets/js/header.js"></script> juste après <body>.
"""
import re
import sys
from pathlib import Path

FRONTEND = Path("frontend")

TARGETS = [
    ("index.html", True),
    ("tarifs.html", True),
    ("abonnement.html", True),
    ("account.html", True),
    # room.html : page d'intégration de la réunion, pas d'en-tête de site.
]

HEADER_PATTERNS = [
    re.compile(r"[ \t]*<header[^>]*cm-header-unified[^>]*>.*?</header>[ \t]*\n?", re.S),
    re.compile(r"[ \t]*<header[^>]*class=\"topbar\"[^>]*>.*?</header>[ \t]*\n?", re.S),
    re.compile(r"[ \t]*<nav[^>]*class=\"cm-nav-unified\"[^>]*>.*?</nav>[ \t]*\n?", re.S),
]

COMPARE_SECTION = re.compile(r"[ \t]*<section[^>]*id=\"compare\"[^>]*>.*?</section>[ \t]*\n?", re.S)

STYLE_PATTERN = re.compile(r"[ \t]*<style[^>]*>.*?</style>[ \t]*\n?", re.S)
REMOVE_STYLE_MARKERS = (".cm-compare", ".cm-table-wrap")
KEEP_STYLE_MARKERS = (".hero", ".features", ".lobby", ".footer", ".card", ".btn")

SCRIPT_TAG = '<script src="/assets/js/header.js"></script>'
BODY_RE = re.compile(r"(<body[^>]*>)", re.I)


def remove_blocks(html: str) -> tuple[str, int]:
    removed = 0
    for pat in HEADER_PATTERNS + [COMPARE_SECTION]:
        html, n = pat.subn("", html)
        removed += n

    def style_sub(m):
        nonlocal removed
        block = m.group(0)
        has_remove = any(k in block for k in REMOVE_STYLE_MARKERS)
        has_keep = any(k in block for k in KEEP_STYLE_MARKERS)
        if has_remove and not has_keep:
            removed += 1
            return ""
        return block

    html = STYLE_PATTERN.sub(style_sub, html)
    return html, removed


def install(html: str) -> tuple[str, bool]:
    if "assets/js/header.js" in html:
        return html, False
    return BODY_RE.sub(lambda m: m.group(1) + "\n" + SCRIPT_TAG, html, count=1), True


def main() -> int:
    changed = []
    for rel, do_install in TARGETS:
        path = FRONTEND / rel
        if not path.exists():
            print(f"  ABSENT  {rel}")
            continue
        original = path.read_text(encoding="utf-8")
        html = original
        html, removed = remove_blocks(html)
        installed = False
        if do_install:
            html, installed = install(html)
        if html != original:
            path.write_text(html, encoding="utf-8")
            print(f"  OK      {rel}  (blocs supprimés: {removed}, "
                  f"composant: {'installé' if installed else 'déjà présent'})")
            changed.append(rel)
        else:
            print(f"  INCHANGE {rel}")
    print(f"\n{len(changed)} fichier(s) modifié(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
