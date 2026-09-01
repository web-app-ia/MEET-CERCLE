// ---------------------------------------------------------------------------
// Session SFU — LiveKit (SDK chargé dynamiquement depuis le CDN).
// Le serveur LiveKit est éphème ; url + token proviennent de /api/rooms/:room/join.
// ---------------------------------------------------------------------------

const LIVEKIT_SDK_URL = "https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.esm.mjs";

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import(/* webpackIgnore: true */ LIVEKIT_SDK_URL);
  return sdkPromise;
}

export class SfuSession {
  /**
   * @param {object} opts
   * @param {string} opts.url     wss://sfu-xxxx.sfu.example.com
   * @param {string} opts.token   token JWT LiveKit participant
   * @param {MediaStream|null} opts.localStream
   * @param {object} opts.handlers callbacks UI (onRemoteStream, onPeerDiscovered, onPeerLeft, onChat, onError, onStatus, onDisconnected)
   */
  constructor(opts) {
    this.url = opts.url;
    this.token = opts.token;
    this.localStream = opts.localStream;
    this.handlers = opts.handlers;
    this.room = null;
    this.closed = false;
    /** pid → identity (pour le chat) */
    this.identityCache = new Map();
  }

  async connect() {
    const { Room, RoomEvent, Track } = await loadSdk();
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      const stream = new MediaStream([track.mediaStreamTrack]);
      this.handlers.onRemoteStream?.(participant.identity, stream, track.kind);
    });
    room.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
      this.handlers.onPeerLeft?.(participant.identity);
    });
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      this.identityCache.set(participant.identity, participant.name || participant.identity);
      this.handlers.onPeerDiscovered?.(participant.identity, participant.name || participant.identity);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.handlers.onPeerLeft?.(participant.identity);
    });
    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg.type === "chat") {
          this.handlers.onChat?.({
            from: participant ? participant.identity : "système",
            text: msg.text,
            ts: msg.ts || Date.now(),
          });
        }
      } catch {
        // payload inconnu : ignoré
      }
    });
    room.on(RoomEvent.Disconnected, (reason) => {
      if (!this.closed) this.handlers.onDisconnected?.(reason);
    });
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      this.handlers.onStatus?.(`sfu-${state}`);
    });

    this.handlers.onStatus?.("sfu-connexion");
    await room.connect(this.url, this.token);
    this.handlers.onStatus?.("sfu-connecté");

    // Présence des participants déjà là
    for (const p of room.remoteParticipants.values()) {
      this.identityCache.set(p.identity, p.name || p.identity);
      this.handlers.onPeerDiscovered?.(p.identity, p.name || p.identity);
    }

    // Publication des pistes locales
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (videoTrack) await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
      if (audioTrack) await room.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });
    }
  }

  sendChat(text) {
    if (!this.room) return;
    const data = new TextEncoder().encode(JSON.stringify({ type: "chat", text, ts: Date.now() }));
    this.room.localParticipant.publishData(data, { reliable: true });
  }

  /** Mute/dépublie (true = actif). */
  setTrackEnabled(kind, enabled) {
    if (!this.room) return;
    const lp = this.room.localParticipant;
    if (kind === "audio") lp.setMicrophoneEnabled(enabled);
    if (kind === "video") lp.setCameraEnabled(enabled);
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        if (track.kind === kind) track.enabled = enabled;
      }
    }
  }

  close() {
    this.closed = true;
    if (this.room) {
      try {
        this.room.disconnect();
      } catch {
        // déjà déconnecté
      }
      this.room = null;
    }
  }
}
