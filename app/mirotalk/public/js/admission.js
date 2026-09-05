'use strict';

// CERCLE MEET — Admission lobby (host toggle + guest waiting room)
// Loaded AFTER client.js, so the globals signalingSocket / roomId / isPresenter / getId
// are already defined in the shared classic-script scope.

(function () {
    const admissionBtn = getId('admissionBtn');
    const admissionOffBtn = getId('admissionOffBtn');
    const admissionPanel = getId('admissionPanel');
    const admissionRequests = getId('admissionRequests');
    const admissionCount = getId('admissionCount');
    const admissionOverlay = getId('admissionOverlay');
    const admissionOverlayTitle = getId('admissionOverlayTitle');
    const admissionOverlayText = getId('admissionOverlayText');
    const admissionOverlayBtn = getId('admissionOverlayBtn');

    let enabled = false;

    function showEl(el, v) {
        if (!el) return;
        if (v) el.classList.remove('hidden');
        else el.classList.add('hidden');
    }

    function injectStyles() {
        if (document.getElementById('cercleAdmStyle')) return;
        const s = document.createElement('style');
        s.id = 'cercleAdmStyle';
        s.textContent = `
.admission-panel{position:fixed;right:16px;bottom:16px;width:280px;max-height:60vh;overflow:auto;
  background:#fff;border:1px solid #e2e2e2;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:9999;font-family:inherit}
.admission-panel-head{display:flex;align-items:center;gap:8px;padding:10px 12px;font-weight:600;border-bottom:1px solid #eee;background:#f7f7f7;border-radius:12px 12px 0 0}
.admission-count{margin-left:auto;background:#e8492b;color:#fff;border-radius:999px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0 6px}
.admission-requests{padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.admission-request{display:flex;align-items:center;gap:6px;font-size:14px}
.admission-request .adm-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.admission-request button{font-size:12px;padding:4px 8px;border:none;border-radius:6px;cursor:pointer;color:#fff}
.admission-request .green{background:#1f9d55}
.admission-request .red{background:#e8492b}
.admission-overlay{position:fixed;inset:0;background:rgba(20,22,28,.82);display:flex;align-items:center;justify-content:center;z-index:10000}
.admission-overlay-card{background:#fff;border-radius:14px;padding:28px 32px;text-align:center;max-width:360px;color:#222}
.admission-overlay-card i{color:#e8492b;margin-bottom:10px}
.admission-overlay-card h3{margin:6px 0}
.admission-overlay-card p{color:#555;margin:6px 0 14px}
.admission-overlay-card button{margin-top:8px;padding:8px 16px;border:none;border-radius:8px;background:#e8492b;color:#fff;cursor:pointer}
`;
        document.head.appendChild(s);
    }

    function updateButtons() {
        const host = isPresenter === true;
        showEl(admissionBtn, host && !enabled);
        showEl(admissionOffBtn, host && enabled);
        showEl(admissionPanel, host && enabled);
        refreshCount();
    }

    function refreshCount() {
        if (!admissionCount || !admissionRequests) return;
        admissionCount.textContent = String(admissionRequests.children.length);
    }

    function addRequest(req) {
        if (!req || !req.peer_id) return;
        let row = getId('adm_' + req.peer_id);
        if (!row) {
            row = document.createElement('div');
            row.id = 'adm_' + req.peer_id;
            row.className = 'admission-request';

            const name = document.createElement('span');
            name.className = 'adm-name';
            name.textContent = req.peer_name || 'Invité';

            const acc = document.createElement('button');
            acc.className = 'green';
            acc.textContent = 'Accepter';

            const rej = document.createElement('button');
            rej.className = 'red';
            rej.textContent = 'Refuser';

            row.appendChild(name);
            row.appendChild(acc);
            row.appendChild(rej);
            admissionRequests.appendChild(row);

            acc.addEventListener('click', function () {
                signalingSocket.emit('admissionAccept', { room_id: roomId, peer_id: req.peer_id });
            });
            rej.addEventListener('click', function () {
                signalingSocket.emit('admissionReject', { room_id: roomId, peer_id: req.peer_id });
            });
        }
        refreshCount();
    }

    function removeRequest(peer_id) {
        const row = getId('adm_' + peer_id);
        if (row && row.parentNode) row.parentNode.removeChild(row);
        refreshCount();
    }

    function showPending() {
        // The host/presenter is NEVER held in the lobby. Even if a stray
        // "admissionPending" event ever arrives, the meeting creator must never be
        // blocked behind the "waiting for approval" screen.
        if (isPresenter === true) {
            showEl(admissionOverlay, false);
            return;
        }
        if (admissionOverlayTitle) admissionOverlayTitle.textContent = 'En attente d’approbation…';
        if (admissionOverlayText)
            admissionOverlayText.textContent = 'L’hôte doit valider votre accès à la réunion.';
        // Always offer a way out, so a guest is never trapped with no way back.
        showEl(admissionOverlayBtn, true);
        showEl(admissionOverlay, true);
        // Hide as soon as the host accepts (server then sends serverInfo / addPeer)
        signalingSocket.once('serverInfo', function () {
            showEl(admissionOverlay, false);
        });
        signalingSocket.once('addPeer', function () {
            showEl(admissionOverlay, false);
        });
    }

    function showDenied() {
        // Same guard: a presenter can never be denied entry to their own room.
        if (isPresenter === true) {
            showEl(admissionOverlay, false);
            return;
        }
        if (admissionOverlayTitle) admissionOverlayTitle.textContent = 'Accès refusé';
        if (admissionOverlayText)
            admissionOverlayText.textContent = 'L’hôte a refusé votre demande d’accès à cette réunion.';
        showEl(admissionOverlayBtn, true);
        showEl(admissionOverlay, true);
    }

    function init() {
        injectStyles();

        if (admissionBtn)
            admissionBtn.addEventListener('click', function () {
                enabled = true;
                updateButtons();
                signalingSocket.emit('admissionToggle', { room_id: roomId, enabled: true });
            });
        if (admissionOffBtn)
            admissionOffBtn.addEventListener('click', function () {
                enabled = false;
                if (admissionRequests) admissionRequests.innerHTML = '';
                updateButtons();
                signalingSocket.emit('admissionToggle', { room_id: roomId, enabled: false });
            });

        signalingSocket.on('admissionRequest', function (req) {
            addRequest(req);
        });
        signalingSocket.on('admissionCleared', function (d) {
            removeRequest(d.peer_id);
        });
        signalingSocket.on('admissionOn', function (d) {
            if (d.room_id === roomId) {
                enabled = true;
                updateButtons();
            }
        });
        signalingSocket.on('admissionOff', function (d) {
            if (d.room_id === roomId) {
                enabled = false;
                if (admissionRequests) admissionRequests.innerHTML = '';
                updateButtons();
            }
        });
        signalingSocket.on('admissionPending', function () {
            showPending();
        });
        signalingSocket.on('admissionDenied', function () {
            showDenied();
        });
        // Keep host controls in sync once the server confirms we are presenter
        signalingSocket.on('serverInfo', function () {
            updateButtons();
        });

        updateButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
