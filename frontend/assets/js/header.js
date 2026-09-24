/**
 * CERCLE MEET — En-tête de site unifié (source de vérité unique).
 *
 * Ce fichier injecte à la fois la feuille de style et le balisage de
 * l'en-tête. Toutes les pages l'incluent avec une seule ligne placée juste
 * après <body> :
 *
 *     <script src="/js/header.js"></script>
 *
 * Objectif : une seule définition pour tout le site. Modifier l'en-tête ici
 * le met à jour partout (accueil, tarifs, comparer, compte, 404, ...).
 *
 * Thème sombre (font sombre) par défaut, cohérent avec le portail.
 * Le logo est un SVG inline : aucune dépendance à une image, donc aucun
 * problème de chemin relatif entre les pages servies à la racine et celles
 * servies depuis /views/.
 */
(function () {
    'use strict';

    var STYLE_ID = 'cm-site-header-style';
    var SESSION_KEY = 'meet-cercle-session';

    var LINKS = [
        { href: '/', label: 'Accueil', match: ['/'] },
        { href: '/tarifs.html', label: 'Tarifs', match: ['/tarifs.html', '/abonnement.html'] },
        { href: '/comparer.html', label: 'Comparer', match: ['/comparer.html'] },
    ];

    var CTA = { href: '/account.html', label: 'Connexion', match: ['/account.html'] };

    var CSS = [
        '.cm-site-header{',
        '  position:fixed;top:0;left:0;right:0;height:64px;z-index:1000;',
        '  display:flex;align-items:center;justify-content:space-between;gap:24px;',
        '  padding:0 24px;background:#0b0f17;border-bottom:1px solid rgba(255,255,255,0.08);',
        '  font-family:"Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;',
        '}',
        '.cm-site-header *{box-sizing:border-box}',
        '.cm-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#f8fafc;',
        '  font-weight:700;font-size:15px;letter-spacing:.04em;white-space:nowrap}',
        '.cm-brand:hover{color:#ffffff}',
        '.cm-brand svg,.cm-brand img{display:block;flex:0 0 auto;border-radius:8px}',
        '.cm-site-nav{display:flex;align-items:center;gap:26px}',
        '.cm-site-nav a{position:relative;color:#cbd5e1;text-decoration:none;font-weight:600;',
        '  font-size:14px;padding:6px 2px;transition:color .15s ease}',
        '.cm-site-nav a:hover{color:#ffffff}',
        '.cm-site-nav a.is-active{color:#ffffff}',
        '.cm-site-nav a.is-active::after{content:"";position:absolute;left:0;right:0;bottom:-2px;',
        '  height:2px;border-radius:2px;background:#016FED}',
        '.cm-site-cta{display:inline-flex;align-items:center;background:#016FED;color:#ffffff;',
        '  text-decoration:none;font-weight:600;font-size:14px;padding:9px 16px;',
        '  border-radius:8px;white-space:nowrap;transition:background .15s ease}',
        '.cm-site-cta:hover{background:#0339B9;color:#ffffff}',
        'body{padding-top:64px}',
        '@media(max-width:720px){',
        '  .cm-site-header{height:56px;padding:0 14px;gap:10px}',
        '  .cm-site-nav{gap:14px}',
        '  .cm-site-nav a{font-size:13px}',
        '  .cm-brand span{display:none}',
        '  .cm-site-cta{padding:7px 12px;font-size:13px}',
        '  body{padding-top:56px}',
        '}',
        '@media(max-width:420px){',
        '  .cm-site-nav{gap:10px}',
        '  .cm-site-nav a{font-size:12px}',
        '}',
    ].join('\n');

    var LOGO_SVG =
        '<img src="/assets/img/logo-cercle.png" width="32" height="32" alt="" aria-hidden="true">';

    function normalize(path) {
        var p = String(path || '').replace(/\/+$/, '');
        return p === '' ? '/' : p;
    }

    function currentPath() {
        return normalize(window.location.pathname);
    }

    function isActive(matchList) {
        var path = currentPath();
        for (var i = 0; i < matchList.length; i++) {
            var m = normalize(matchList[i]);
            if (m === '/') {
                if (path === '/' || path === '/index.html') return true;
            } else if (path === m) {
                return true;
            }
        }
        return false;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function buildHeader() {
        var header = el('header', 'cm-site-header');
        header.setAttribute('role', 'banner');

        var brand = el('a', 'cm-brand');
        brand.setAttribute('href', '/');
        brand.setAttribute('aria-label', 'CERCLE MEET — accueil');
        brand.innerHTML = LOGO_SVG;
        brand.appendChild(el('span', null, 'CERCLE MEET'));
        header.appendChild(brand);

        var nav = el('nav', 'cm-site-nav');
        nav.setAttribute('aria-label', 'Navigation principale');

        LINKS.forEach(function (item) {
            var a = el('a', null, item.label);
            a.setAttribute('href', item.href);
            if (isActive(item.match)) {
                a.classList.add('is-active');
                a.setAttribute('aria-current', 'page');
            }
            nav.appendChild(a);
        });

        var cta = el('a', 'cm-site-cta', CTA.label);
        cta.setAttribute('href', CTA.href);
        cta.id = 'nav-account';
        if (isActive(CTA.match)) cta.setAttribute('aria-current', 'page');
        nav.appendChild(cta);

        header.appendChild(nav);

        // Si une session existe, le bouton devient « Déconnecter ».
        try {
            var raw = window.localStorage.getItem(SESSION_KEY);
            var session = raw ? JSON.parse(raw) : null;
            if (session && session.token) {
                cta.textContent = 'Déconnecter';
                cta.setAttribute('href', '#');
                cta.addEventListener('click', function (e) {
                    e.preventDefault();
                    window.localStorage.removeItem(SESSION_KEY);
                    window.location.href = '/';
                });
            }
        } catch (err) {
            /* localStorage indisponible : on laisse « Connexion » */
        }

        return header;
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function mount() {
        if (document.querySelector('.cm-site-header')) return;
        injectStyle();
        document.body.insertBefore(buildHeader(), document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
