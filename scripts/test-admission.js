'use strict';
const { io } = require('C:/Users/Fouit/.verdent/verdent-projects/code-ce-projet-realise/app/mirotalk/node_modules/socket.io-client');

const URL = 'http://127.0.0.1:3000';
const room = 'testadmr' + Math.floor(Math.random() * 1e9);
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

function mk(name, uuid) {
    return new Promise((resolve) => {
        const s = io(URL, { transports: ['websocket'] });
        const got = { pending: false, serverInfo: false };
        s.on('connect', () => s.emit('join', cfg(name, uuid)));
        s.on('admissionPending', () => { got.pending = true; });
        s.on('serverInfo', () => { got.serverInfo = true; });
        setTimeout(() => { resolve({ s, got }); }, 800);
    });
}

(async () => {
    // 1) Fresh room — first joiner (host)
    const host = await mk('Host', 'uuid-host-1');
    console.log('FRESH ROOM — host (first joiner):', JSON.stringify(host.got));
    await new Promise((r) => setTimeout(r, 400));

    // 2) Same fresh room — second joiner (guest), admission OFF
    const guest = await mk('Guest', 'uuid-guest-2');
    console.log('FRESH ROOM — guest (admission OFF):', JSON.stringify(guest.got));
    await new Promise((r) => setTimeout(r, 400));

    // 3) Host enables admission lobby
    host.s.emit('admissionToggle', { room_id: room, enabled: true });
    await new Promise((r) => setTimeout(r, 500));

    // 4) New guest joins — should now be held (pending)
    const guest2 = await mk('Guest2', 'uuid-guest-3');
    console.log('ADMISSION ON — guest2 (should be held):', JSON.stringify(guest2.got));

    host.s.close(); guest.s.close(); guest2.s.close();
    process.exit(0);
})();
