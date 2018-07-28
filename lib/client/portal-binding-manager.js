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

///////////////////////////// ERRORS AND LOGGING ///////////////////////////////
import config from './../../config.js';

function logError(message) {
  console.error('PORTAL BINDING MANAGER: ' + message);
}

function log(message) {
  console.log('PORTAL BINDING MANAGER: ' + message);
}

function logDebug(message) {
  if (config.debug) log(message);
}
////////////////////////////////////////////////////////////////////////////////

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
    log('Initialising...');
    if (!this.peerConnectionLayer) {
      this.peerConnectionLayer = await this.getOrCreatePeerConnectionLayer();
    }
    // Tell portal binding manager to listen to messages from peer conn. layer
    await this.peerConnectionLayer.onDidEmitMessage(
      this._handlePeerConnLayerMessage.bind(this)
    );
    logDebug('Listening to events from peer connection layer');
  }

  /******************************* PUBLIC API *********************************/

  onDidChange(callback) {
    this.emitter.on('did-change', callback);
  }

  /**
   * Send a message to a specific peer (typically used to send initialisation
   * messages to a new guest peer)
   */
  sendMessageToPeer(msg, targetPeerId) {
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
    this.peerConnectionLayer.sendMessageToPeer(portalHostPeerId, msg);
  }

  /**
   * Establish a WebRTC connection to the give peer
   */
  connectToPeer(targetPeerId) {
    logDebug(`Connecting to peer ${targetPeerId}`);
    if (!this.peerConnectionLayer) {
      logError(
        `Cannot connect to peer ${targetPeerId} with uninitialised peer ` +
        `connection layer.`
      );
      return;
    }
    this.peerConnectionLayer.connectToPeer(targetPeerId);
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message received from the host portal binding.
   */
  _handleHostPortalMessage(message) {
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
    const msg = JSON.stringify(message);
    this.peerConnectionLayer.sendMessageToPeer(msg, message.portalHostPeerId);
  }

  _handleStateMessageBatches({targetPeerId, messageBatches}) {
    for (let i = 0; i < messageBatches.length; i++) {
      const msg = JSON.stringify(messageBatches[i]);
      this.peerConnectionLayer.sendMessageToPeer(msg, targetPeerId);
    }
  }

  /*********************** LOWER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message delivered by the peer connection layer.
   */
  _handlePeerConnLayerMessage(msg) {
    if (msg.type === LOCAL_PEER_ID) {

      this.localPeerId = msg.localPeerId;
      log(`Local Peer ID "${this.localPeerId}" delivered.`);
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
    if (!payload.portalHostPeerId) {
      logError(`Message ${msg} contains no portal ID`);
      return;
    }

    if (payload.type === JOIN_PORTAL) {

      if (payload.portalHostPeerId !== this.localPeerId) {
        let errString = `Remote peer ${payload.senderPeerId} wants to join `;
        errString += `portal ${payload.portalHostPeerId} but this peer has `;
        errString += `peer ID ${this.localPeerId}`;
        logError(errString);
        return;
      }

      // Register new guest peer and send initialisation messages
      this.hostPortalBinding.peerDidJoin(payload.portalHostPeerId);
      this._sayHelloToGuestPeer(payload.senderPeerId);

    } else if (payload.type === NOTIFICATION) {

      this.notificationManager.addInfo(payload.data);

    } else {

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
      logError(`No GuestPortalBinding for portal host ${portalHostPeerId}`);
      return;
    }
    return portalBinding;
  }

  async getOrCreateHostPortalBinding() {
    if (this.hostPortalBinding) return this.hostPortalBinding;

    logDebug('Creating host portal binding...');
    this.hostPortalBinding = new HostPortalBinding({
      workspace: this.workspace,
      notificationManager: this.notificationManager
    });
    await this.hostPortalBinding.initialise();

    // Add event handlers
    logDebug('Listening to events from host portal...');

    this.hostPortalBinding.onDidLocalInsert(
      this._handleHostPortalMessage.bind(this)
    );

    this.hostPortalBinding.onDidLocalDelete(
      this._handleHostPortalMessage.bind(this)
    );

    this.hostPortalBinding.onCurrentStateMessageBatches(
      this._handleStateMessageBatches.bind(this)
    );

    return this.hostPortalBinding;
  }

  /**
   * Create a guest portal binding
   */
  createGuestPortalBinding(portalHostPeerId) {
    const props = {
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      portalHostPeerId: portalHostPeerId,
      localPeerId: this.localPeerId,
    };

    const guestPortalBinding = new GuestPortalBinding(props);

    guestPortalBinding.onDidLocalInsert(
      this._handleGuestPortalMessage.bind(this)
    );

    guestPortalBinding.onDidLocalDelete(
      this._handleGuestPortalMessage.bind(this)
    );

    this.guestPortalBinding.set(portalHostPeerId, guestPortalBinding);

    return guestPortalBinding;
  }

  /**
   * Create a peer connection layer
   */
  async getOrCreatePeerConnectionLayer() {
    if (this.peerConnectionLayer) return this.peerConnectionLayer;
    const peerConnectionLayer = new PeerConnectionLayer();
    await peerConnectionLayer.initialise();
    return peerConnectionLayer;
  }

  /**
   * Returns `true` iff there are currently any host/guest portals
   */
  hasActivePortals() {
    return this.hostPortalBinding || this.guestPortalBindings.size > 0;
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
