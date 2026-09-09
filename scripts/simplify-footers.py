#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Remplace tous les pieds de page marketing CERCLE MEET (variants 2/3/4) par une
seule ligne de copyright, dans les copies portail (frontend/) et moteur
(app/mirotalk/public/). Ajoute aussi le pied de page copyright sur comparer.html
(portail + moteur) qui n'en avait pas.

On utilise une regex sur l'ensemble du bloc <footer class="footer">...</footer>
pour éviter d'avoir à matcher à la main le mojibake (ex. "â†" dans
"Retour au portail").
"""
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COPY = (
    '  <footer class="footer">\n'
    '    <span>\u00a9 2026 CERCLE MEET \u00b7 R\u00e9unions simples, priv\u00e9es et accessibles.</span>\n'
    '  </footer>\n'

)

FILES = [
    'frontend/index.html',
    'frontend/tarifs.html',
    'frontend/account.html',
    'frontend/abonnement.html',
    'frontend/comparer.html',
    'app/mirotalk/public/views/landing.html',
    'app/mirotalk/public/tarifs.html',
    'app/mirotalk/public/account.html',
    'app/mirotalk/public/abonnement.html',
    'app/mirotalk/public/comparer.html',
]

footer_re = re.compile(r'<footer class="footer">.*?</footer>', re.DOTALL)


def main():
    for rel in FILES:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            print('SKIP (introuvable):', rel)
            continue
        with open(path, 'r', encoding='utf-8') as fh:
            html = fh.read()

        if footer_re.search(html):
            new_html = footer_re.sub(COPY, html, count=1)
            action = 'remplace'
        else:
            # comparer.html : aucun pied de page -> on en insère un avant </body>
            if '</body>' not in html:
                print('SKIP (pas de </body>):', rel)
                continue
            new_html = html.replace('</body>', COPY + '</body>', 1)
            action = 'ajoute'

        if new_html == html:
            print('INCHANGE:', rel)
            continue

        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(new_html)
        print(f'{action:8} ->', rel)


if __name__ == '__main__':
    main()
