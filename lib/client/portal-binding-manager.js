'use babel';

const {Emitter} = require('atom');
const HostPortalBinding = require('./host-portal-binding.js');
const PeerConnectionLayer = require('./peer-connection-layer.js');
const {ANIMALS, ADJECTIVES} = require('./default-usernames.js');
const uuid = require('uuid/v1');
const MessageTypes = require('./message-types.js');

const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;
const DATA_CHANNEL_MESSAGE = MessageTypes.DATA_CHANNEL_MESSAGE;
const JOIN_PORTAL = MessageTypes.JOIN_PORTAL;
const NOTIFICATION = MessageTypes.NOTIFICATION;

// Logging
const log = require('loglevel').getLogger('portal-binding-manager');
const config = require('./../../config.js')
log.setLevel(config.logLevels.models);

/**
 * Convert the object {lineIndex: ..., charIndex: ...} to an Atom `Range` object
 */
function _convertPositionsToRange(startPos, endPos) {
  const startPoint = [startPos.lineIndex, startPos.charIndex];
  const endPoint = [endPos.lineIndex, endPos.charIndex];
  return new Range(startPoint, endPoint);
}

function getRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}
////////////////////////////////////////////////////////////////////////////////

class PortalBindingManager {
  constructor(options) {
    const {workspace, notificationManager} = options;

    this.workspace = workspace;
    this.notificationManager = notificationManager;

    this.emitter = new Emitter();
    // Unique local peer ID assigned by signaling server (this is the ID that
    // will be shared with remote peers when they wish to connect the portal
    // hosted by "this" peer)
    this.localPeerId;
    // Username of peer
    this.username = getRandom(ADJECTIVES) + '_' + getRandom(ANIMALS);
    // Peer connection layer abstraction used to handle network connections
    this.peerConnectionLayer;
    // Host portal binding
    this.hostPortalBinding;
    // Guest portal binding
    this.guestPortalBindings = new Map();
  }

  /**
   * Initialise the portal binding manager.
   */
  async initialise() {
    log.debug('Initialising...');
    if (!this.peerConnectionLayer) {
      this.peerConnectionLayer = await this.getOrCreatePeerConnectionLayer();
    }
    // Tell portal binding manager to listen to messages from peer conn. layer
    await this.peerConnectionLayer.onDidEmitMessage(
      this._handlePeerConnLayerMessage.bind(this)
    );
  }

  /******************************* PUBLIC API *********************************/

  onPortalsStatusChange(callback) {
    this.emitter.on('portals-status-change', callback);
  }

  onCreatedHostPortal(callback) {
    this.emitter.on('created-host-portal', callback);
  }

  onClosedHostPortal(callback) {
    this.emitter.on('closed-host-portal', callback);
  }

  onJoinedGuestPortal(callback) {
    this.emitter.on('joined-guest-portal', callback);
  }

  onLeftGuestPortal(callback) {
    this.emitter.on('left-guest-portal', callback);
  }

  /**
   * Send a message to a specific peer (typically used to send initialisation
   * messages to a new guest peer)
   */
  sendMessageToPeer(msg, targetPeerId) {
    log.debug('Sending message: ', msg, ' to peer: ', targetPeerId);
    this.peerConnectionLayer.sendMessageToPeer(msg, targetPeerId);
  }

  /**
   * Join a portal (hosted by a remote peer)
   */
  sendJoinPortalMessage(portalHostPeerId) {
    const msg = {
      type: JOIN_PORTAL,
      portalHostPeerId: portalHostPeerId,
      senderPeerId: this.localPeerId,
    };
    log.debug('Sending message: ', msg, ' to peer: ', portalHostPeerId);
    this.peerConnectionLayer.sendMessageToPeer(portalHostPeerId, msg);
  }

  /**
   * Establish a WebRTC connection to the give peer
   */
  connectToPeer(targetPeerId) {
    log.debug('Connecting to peer: ', targetPeerId);
    if (!this.peerConnectionLayer) {
      logError(
        `Cannot connect to peer ${targetPeerId} with uninitialised peer ` +
        `connection layer.`
      );
      let info = 'Cannot connect to peer: ' + targetPeerId + ' with';
      info += ' uninitialised peer connection layer';
      log.error(info);
      return;
    }
    this.peerConnectionLayer.connectToPeer(targetPeerId);
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message received from the host portal binding.
   */
  _handleHostPortalMessage(message) {
    log.trace('Handling message from host portal binding: ', message);
    
    // Need to inspect portal ID of message and tell peer conn. layer to send
    // the message to every peer in the portal.
    let msg = Object.assign({}, message);
    const targetPeerIds = Object.assign([], message.targetPeerIds);
    delete msg.targetPeerIds;
    msg = JSON.stringify(msg);

    for (const targetPeerId of targetPeerIds) {
      this.peerConnectionLayer.sendMessageToPeer(msg, targetPeerId)
    }
  }

  /**
   * Handle a message received from a guest portal binding
   */
  _handleGuestPortalMessage(message) {
    log.trace('Handling message from guest portal binding: ', message);

    const msg = JSON.stringify(message);
    this.peerConnectionLayer.sendMessageToPeer(msg, message.portalHostPeerId);
  }

  _handleStateMessageBatches({targetPeerId, messageBatches}) {
    log.debug('Handling state message batches. Target peer ID: ', targetPeerId);
    for (let i = 0; i < messageBatches.length; i++) {
      const msg = JSON.stringify(messageBatches[i]);
      this.peerConnectionLayer.sendMessageToPeer(msg, targetPeerId);
    }
  }

  /**
   * Handler for when the host portal signals that it has closed
   */
  _handleClosedHostPortal() {
    log.debug('Handling closed host portal binding...');
    // Lose the reference and emit an event
    this.hostPortalBinding = null;
    this.emitter.emit('closed-host-portal');
    this.emitter.emit('portals-status-change');
  }

  /**
   * Handler for when guest portal signals that it has closed
   */
  _handleClosedGuestPortal(portalHostPeerId) {
    let info = 'Handling closed guest portal binding to guest portal binding';
    info += ' for portal host: ' + portalHostPeerId;
    log.debug(info);

    if (!this.guestPortalBindings) {
      logError('No reference to guest portal bindings');
      return;
    }
    if (!this.guestPortalBindings.has(portalHostPeerId)) {
      let errString = `Guest portal connected to peer ${portalHostPeerId} `;
      errString += `does not exist`;
      logError(errString);
      return;
    }
    this.guestPortalBindings.delete(portalHostPeerId);
    const myEvent = {portalHostPeerId: portalHostPeerId};
    this.emitter.emit('left-guest-portal', myEvent);
    this.emitter.emit('portals-status-change');
  }

  /*********************** LOWER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message delivered by the peer connection layer.
   */
  _handlePeerConnLayerMessage(msg) {
    log.debug('Handling message from peer connection layer: ', msg);
    if (msg.type === LOCAL_PEER_ID) {

      this.localPeerId = msg.localPeerId;
      this.notificationManager.addInfo(`Local Peer ID: ${this.localPeerId}`);

    } else if (msg.type === DATA_CHANNEL_MESSAGE) {

      // Message received over data channel
      const payload = JSON.parse(msg.data);
      this._handleDataChannelPayload(msg, payload);
    }
  }

  /**
   * Handle payload from a message delivered over an RTCDataChannel
   */
  _handleDataChannelPayload(originalMessage, payload) {
    log.debug('Handling data channel payload: ', payload);
    if (!payload.portalHostPeerId) {
      log.error('Data channel payload contains no portal ID');
      log.info('Payload: ', payload);
      return;
    }

    if (payload.type === JOIN_PORTAL) {

      if (payload.portalHostPeerId !== this.localPeerId) {
        let errString = `Remote peer ${payload.senderPeerId} wants to join `;
        errString += `portal ${payload.portalHostPeerId} but this peer has `;
        errString += `peer ID ${this.localPeerId}`;
        log.error(errString);
        return;
      }

      // Register new guest peer and send initialisation messages
      this.hostPortalBinding.peerDidJoin(payload.portalHostPeerId);
      this._sayHelloToGuestPeer(payload.senderPeerId);

    } else if (payload.type === NOTIFICATION) {

      this.notificationManager.addInfo(payload.data);

    } else {

      // We just forward the message to the necessary portal bindings

      if (payload.portalHostPeerId === this.localPeerId) {
        // Message received from remote peer which is connected to the portal
        // hosted by this peer.

        let new_payload = Object.assign({}, payload);
        new_payload.textBufferProxyId =
          this._stripUsernameFromBufferProxyId(new_payload.textBufferProxyId);

        this.hostPortalBinding.handleRemoteMessage(new_payload);

        // Due to star network topology (with portal host at centre), we need to
        // forward the message to all guest peers other than the sender
        for (const guestPeerId of this.hostPortalBinding.getGuestPeerIds()) {
          if (guestPeerId !== payload.senderPeerId) {
            const peerConnLayer = this.peerConnectionLayer;
            peerConnLayer.sendMessageToPeer(guestPeerId, originalMessage);
          }
        }
      } else {
        // "this" peer is a guest of the portal referenced by payload.portalId

        let new_payload = Object.assign({}, payload);
        new_payload.textBufferProxyId =
          this._addUsernameToTextBufferProxyId(new_payload.textBufferProxyId);

        const guestPortalBinding =
          this.guestPortalBindings.get(new_payload.portalHostPeerId);
        guestPortalBinding.handleRemoteMessage(new_payload);
      }

    }

  }


  /*************************** GETTERS AND CREATERS ***************************/

  /**
   * Get or create a host-portal binding
   */
  async createHostPortalBinding() {
    log.debug('Creating host portal binding...');
    if (this.hostPortalBinding) this.hostPortalBinding = null;

    this.hostPortalBinding = new HostPortalBinding({
      workspace: this.workspace,
      notificationManager: this.notificationManager
    });
    await this.hostPortalBinding.initialise();

    // Add event handlers
    this._addHostPortalEventHandlers();

    const myEvent = {hostPortalBinding: this.hostPortalBinding};
    this.emitter.emit('created-host-portal', myEvent);
    this.emitter.emit('portals-status-change');
    return this.hostPortalBinding;
  }

  _addHostPortalEventHandlers() {
    this.hostPortalBinding.onDidLocalInsert(
      this._handleHostPortalMessage.bind(this)
    );
    this.hostPortalBinding.onDidLocalDelete(
      this._handleHostPortalMessage.bind(this)
    );
    this.hostPortalBinding.onCurrentStateMessageBatches(
      this._handleStateMessageBatches.bind(this)
    );
    this.hostPortalBinding.onPortalClosed(
      this._handleClosedHostPortal.bind(this)
    );
  }

  /**
   * Create a guest portal binding
   */
  createGuestPortalBinding(portalHostPeerId) {
    let info = 'Creating guest portal binding for portal host: ';
    info += portalHostPeerId;
    log.debug(info);

    const props = {
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      portalHostPeerId: portalHostPeerId,
      localPeerId: this.localPeerId,
    };

    const guestPortalBinding = new GuestPortalBinding(props);
    this._addGuestPortalEventHandlers(guestPortalBinding);

    this.guestPortalBinding.set(portalHostPeerId, guestPortalBinding);

    const myEvent = {
      portalHostPeerId: portalHostPeerId,
      guestPortalBinding: guestPortalBinding,
    };
    this.emitter.emit('joined-guest-portal', myEvent);
    this.emitter.emit('portals-status-change');
    return guestPortalBinding;
  }

  _addGuestPortalEventHandlers(portalBinding) {
    portalBinding.onDidLocalInsert(
      this._handleGuestPortalMessage.bind(this)
    );
    portalBinding.onDidLocalDelete(
      this._handleGuestPortalMessage.bind(this)
    );
    portalBinding.onLeftPortal(
      this._handleClosedGuestPortal.bind(this)
    );
  }
  /**
   * Return a reference to the host portal binding (or undefined if none exists)
   */
  getHostPortalBinding() {
    return this.hostPortalBinding;
  }

  /**
   * Return a reference to the map of guest portal bindings
   */
  getGuestPortalBindings() {
    return this.guestPortalBindings;
  }

  /**
   * Return the guest-portal-binding referenced by the given ID.
   */
  getGuestPortalBinding(portalHostPeerId) {
    const portalBinding = this.guestPortalBindings.get(portalHostPeerId);
    if (!portalBinding) {
      log.error('No guest portal binding for portal host: ', portalHostPeerId);
      return;
    }
    return portalBinding;
  }


  /**
   * Create a peer connection layer
   */
  async getOrCreatePeerConnectionLayer() {
    if (this.peerConnectionLayer) {
      log.debug('Retrieving reference to peer connection layer');
      return this.peerConnectionLayer;
    }
    log.debug('Creating peer connection layer');
    const peerConnectionLayer = new PeerConnectionLayer();
    await peerConnectionLayer.initialise();
    return peerConnectionLayer;
  }

  /**
   * Returns `true` iff there are currently any host/guest portals
   */
  hasActivePortals() {
    return (
      this.hostPortalBinding || (this.guestPortalBindings &&
        this.guestPortalBindings.size > 0)
    );
  }

  /**
   * Return the username of this peer
   */
  getUsername() {
    return this.username;
  }

  /************************ MISCELLANOUS HELPER FUNCTIONS *********************/

  _sayHelloToGuestPeer(guestPeerId) {
    const msg = {
      type: NOTIFICATION,
      data: `Hello from host: ${this.localPeerId}!`
    };
    this.peerConnectionLayer.sendMessageToPeer(msg, guestPeerId);
  }

  /**
   * Strip the username, if it exists, from the buffer proxy ID.
   */
  _stripPortalHostUsernameFromBufferProxyId(bufferProxyId) {
    const [username, rawBufferProxyId] = bufferProxyId.split('/');
    return rawBufferProxyId;
  }

  /**
   * Add the username of this peer to the buffer proxy ID
   */
  _addUsernameToTextBufferProxyId(bufferProxyId) {
    return this.username + '/' + bufferProxyId;
  }
}

module.exports = PortalBindingManager;
