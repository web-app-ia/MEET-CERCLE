'use strict';
// CERCLE MEET — Scenario test for the user's exact complaint:
// "je vois toujours 'En attente d'approbation…' lors du processus de creation de reunion"
//
// Hypothesis under test: a room where a PREVIOUS host had enabled the lobby keeps
// `admission[room] = true` in server memory. When the room is later re-created /
// re-joined, the new creator inherits the barrier even though they never touched
// the host menu.
//
// The disconnect handler added in app/src/server.js must reset the lobby to OFF
// as soon as a room becomes empty, so step 4 below must report pending:false.

const { io } = require('C:/Users/Fouit/.verdent/verdent-projects/code-ce-projet-realise/app/mirotalk/node_modules/socket.io-client');

const URL = 'http://127.0.0.1:3000';
const room = 'reuse' + Math.floor(Math.random() * 1e9);

const cfg = (name, uuid) => ({
    channel: room,
    channel_password: '',
    peer_uuid: uuid,
    peer_name: name,
    peer_token: '',
    peer_video: true,
    peer_audio: true,
    peer_info: { osName: 'win', browserName: 'chrome' },
});

function mk(name, uuid, waitMs = 800) {
    return new Promise((resolve) => {
        const s = io(URL, { transports: ['websocket'] });
        const got = { pending: false, serverInfo: false, isPresenter: null };
        s.on('connect', () => s.emit('join', cfg(name, uuid)));
        s.on('admissionPending', () => { got.pending = true; });
        s.on('admissionDenied', () => { got.denied = true; });
        s.on('serverInfo', (d) => {
            got.serverInfo = true;
            // serverInfo carries the peer list; presenter state is echoed by the app
            got.isPresenter = d && d.isPresenter !== undefined ? d.isPresenter : null;
        });
        setTimeout(() => { resolve({ s, got }); }, waitMs);
    });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    // 1) A host creates the room and explicitly turns the lobby ON
    const h1 = await mk('Host1', 'uuid-h1');
    console.log('1) create room (host1)          :', JSON.stringify(h1.got));
    h1.s.emit('admissionToggle', { room_id: room, enabled: true });
    await wait(500);

    // 2) While ON, a guest IS held — proves the lobby actually works
    const g1 = await mk('Guest1', 'uuid-g1');
    console.log('2) guest while lobby ON         :', JSON.stringify(g1.got), '<- attendu pending:true');

    // 3) EVERYBODY leaves -> room becomes empty
    h1.s.close();
    g1.s.close();
    await wait(1200);

    // 4) The SAME room is created again by a brand-new host.
    //    This is the regression case: must NOT be held.
    const h2 = await mk('Host2-new', 'uuid-h2', 1200);
    console.log('3) re-create same room (host2)  :', JSON.stringify(h2.got), '<- attendu pending:false');

    // 5) And a guest joining that re-created room must not be held either
    const g2 = await mk('Guest2', 'uuid-g2', 1200);
    console.log('4) guest on re-created room     :', JSON.stringify(g2.got), '<- attendu pending:false');

    const ok = h1.got.pending === false && g1.got.pending === true && h2.got.pending === false && g2.got.pending === false;
    console.log('\nRESULTAT:', ok ? 'OK — le sas repasse bien a OFF, jamais une barriere par defaut' : 'ECHEC — le sas reste actif sur un salon re-cree');

    h2.s.close();
    g2.s.close();
    process.exit(ok ? 0 : 1);
})();
