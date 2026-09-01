// ---------------------------------------------------------------------------
// Session P2P — mesh WebRTC avec signalisation relayée par le RoomDO.
//
// Négociation parfaite (perfect negotiation, pattern W3C) :
//  - le rôle "polite" est attribué de façon déterministe (pid lexicographique)
//    pour résoudre les collisions d'offre sans boucle ;
//  - le nouveau venant émet les offres vers les pairs existants (liste "peers").
// ---------------------------------------------------------------------------

export class P2PSession {
  /**
   * @param {object} opts
   * @param {string} opts.room        nom du salon
   * @param {string} opts.pid         identifiant local (issu de /join)
   * @param {string} opts.identity    nom affiché local
   * @param {MediaStream|null} opts.localStream
   * @param {RTCIceServer[]} opts.iceServers
   * @param {string} opts.wsUrl       URL WebSocket de signalisation (absolue)
   * @param {object} opts.handlers    callbacks UI
   */
  constructor(opts) {
    this.room = opts.room;
    this.pid = opts.pid;
    this.identity = opts.identity;
    this.localStream = opts.localStream;
    this.iceServers = opts.iceServers;
    this.wsUrl = opts.wsUrl;
    this.handlers = opts.handlers;

    this.ws = null;
    /** @type {Map<string, {pc: RTCPeerConnection, identity: string, stream: MediaStream|null, polite: boolean, makingOffer: boolean, ignoreOffer: boolean}>} */
    this.peers = new Map();
    this.closed = false;
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onopen = () => {
      this.send({ type: "hello" });
      this.handlers.onStatus?.("p2p-connecté");
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handleSignal(msg).catch((err) => this.handlers.onError?.(err));
    };
    this.ws.onclose = () => {
      if (!this.closed) this.handlers.onDisconnected?.();
    };
    this.ws.onerror = () => this.handlers.onError?.(new Error("Signalisation P2P interrompue"));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendHeartbeat() {
    this.send({ type: "heartbeat" });
  }

  // --- Signalisation ---------------------------------------------------------

  async handleSignal(msg) {
    switch (msg.type) {
      case "peers": {
        // Nous sommes le nouveau : on propose à tous les pairs existants.
        for (const p of msg.peers) {
          this.getOrCreatePeer(p.id, p.identity);
          this.makeOffer(p.id).catch((e) => this.handlers.onError?.(e));
        }
        break;
      }
      case "peer-joined": {
        // Le venu nous proposera ; on prépare juste la tuile.
        this.getOrCreatePeer(msg.from, msg.identity);
        this.handlers.onPeerDiscovered?.(msg.from, msg.identity);
        break;
      }
      case "peer-left": {
        this.removePeer(msg.from);
        this.handlers.onPeerLeft?.(msg.from);
        break;
      }
      case "offer":
      case "answer":
      case "ice":
        await this.handleNegotiation(msg);
        break;
      case "chat":
        this.handlers.onChat?.({ from: msg.from, text: msg.text, ts: msg.ts });
        break;
      case "sfu-ready":
        this.handlers.onSfuReady?.(msg.host, msg.url);
        break;
      case "presence":
        this.handlers.onPresence?.(msg.count);
        break;
      default:
        break;
    }
  }

  getOrCreatePeer(remotePid, identity = "") {
    let peer = this.peers.get(remotePid);
    if (peer) return peer;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    peer = {
      pc,
      identity,
      stream: null,
      polite: this.pid > remotePid, // déterministe : le pid "plus grand" cède
      makingOffer: false,
      ignoreOffer: false,
    };
    this.peers.set(remotePid, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.send({
          type: "ice",
          to: remotePid,
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        });
      }
    };
    pc.ontrack = (ev) => {
      peer.stream = ev.streams[0] || new MediaStream([ev.track]);
      this.handlers.onRemoteStream?.(remotePid, peer.stream);
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: "offer", to: remotePid, sdp: pc.localDescription.sdp });
      } catch (err) {
        this.handlers.onError?.(err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        // Redémarrage ICE tenté une fois
        pc.restartIce?.();
      }
    };
    return peer;
  }

  async makeOffer(remotePid) {
    const peer = this.peers.get(remotePid);
    if (!peer) return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      this.send({ type: "offer", to: remotePid, sdp: peer.pc.localDescription.sdp });
    } finally {
      peer.makingOffer = false;
    }
  }

  async handleNegotiation(msg) {
    const peer = this.getOrCreatePeer(msg.from);
    const { pc } = peer;

    if (msg.type === "offer") {
      const offerCollision = peer.makingOffer || pc.signalingState !== "stable";
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      if (offerCollision) {
        await Promise.all([
          pc.setLocalDescription({ type: "rollback" }).catch(() => undefined),
          pc.setRemoteDescription({ type: "offer", sdp: msg.sdp }),
        ]);
      } else {
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      }
      await pc.setLocalDescription();
      this.send({ type: "answer", to: msg.from, sdp: pc.localDescription.sdp });
    } else if (msg.type === "answer") {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      }
    } else if (msg.type === "ice") {
      try {
        await pc.addIceCandidate({
          candidate: msg.candidate,
          sdpMid: msg.sdpMid,
          sdpMLineIndex: msg.sdpMLineIndex,
        });
      } catch (err) {
        if (!peer.ignoreOffer) this.handlers.onError?.(err);
      }
    }
  }

  // --- Interactions ------------------------------------------------------------

  sendChat(text) {
    this.send({ type: "chat", text });
  }

  async toggleTrack(kind, enabled) {
    for (const sender of []) void sender; // no-op (les tracks sont partagées via localStream)
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        if (track.kind === kind) track.enabled = enabled;
      }
    }
  }

  removePeer(pid) {
    const peer = this.peers.get(pid);
    if (peer) {
      try {
        peer.pc.close();
      } catch {
        // déjà fermée
      }
      this.peers.delete(pid);
    }
  }

  close() {
    this.closed = true;
    for (const pid of Array.from(this.peers.keys())) this.removePeer(pid);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // idem
      }
    }
  }
}
