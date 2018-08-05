'use babel';

const {Emitter} = require('atom');
const HostPortalBinding = require('./host-portal-binding.js');
const PeerConnectionLayer = require('./peer-connection-layer.js');
const {ANIMALS, ADJECTIVES} = require('./default-usernames.js');
const uuid = require('uuid/v1');
const MessageTypes = require('./message-types.js');

// Message types
const JOIN_PORTAL = MessageTypes.JOIN_PORTAL;
const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;
const DATA_CHANNEL_MESSAGE = MessageTypes.DATA_CHANNEL_MESSAGE;
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
    // Guest portal bindings
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

  /**
   * Establish a WebRTC connection to the given peer
   */
  async connectToPeer(targetPeerId) {
    log.debug('Connecting to peer: ', targetPeerId);
    if (!this.peerConnectionLayer) {
      await this.initialise();
    }
    this.peerConnectionLayer.connectToPeer(targetPeerId);
  }

  /**
   * Send the given (unserialized) message to the given peer
   */
  sendMessageToPeer(msg, targetPeerId) {
    log.debug('Sending message: ', msg, ' to peer: ', targetPeerId);
    const peerConnectionLayer = await this.getOrCreatePeerConnectionLayer();
    peerConnectionLayer.sendMessageToPeer(JSON.stringify(msg), targetPeerId);
  }

  /****************** FUNCTIONS TO REGISTER EVENT LISTENERS *******************/

  /**
   * The View classes are the main classes that subscribe to these events.
   * Classes higher in the layered model architecture should not subscribe
   * to these events, as that would introduce cyclic dependencies.
   */

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

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message received from the host portal binding.
   */
  _handleHostPortalMessage(message) {
    log.trace('Handling message from host portal binding: ', message);
    let msg = Object.assign({}, message);
    const targetPeerIds = Object.assign([], message.targetPeerIds);
    delete msg.targetPeerIds;
    msg = JSON.stringify(msg);
    // Send message to all guests
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
    // Only send message to portal host
    this.peerConnectionLayer.sendMessageToPeer(msg, message.portalHostPeerId);
  }

  /**
   * Send the message batches to the given target peer ID.
   */
  _handleStateMessageBatches({targetPeerId, messageBatches}) {
    log.debug('Handling state message batches. Target peer ID: ', targetPeerId);
    for (let i = 0; i < messageBatches.length; i++) {
      log.debug('Sending state message batch: ', i);
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
      log.error('No reference to guest portal bindings');
      return;
    }
    if (!this.guestPortalBindings.has(portalHostPeerId)) {
      let errString = `Guest portal connected to peer ${portalHostPeerId} `;
      errString += `does not exist`;
      log.error(errString);
      return;
    }
    this.guestPortalBindings.delete(portalHostPeerId);
    const myEvent = {portalHostPeerId: portalHostPeerId};
    this.emitter.emit('left-guest-portal', myEvent);
    this.emitter.emit('portals-status-change');
  }

  _handleNewSiteIdForPeer(message) {
    const {targetPeerId} = message;
    const msg = JSON.stringify(message)
    this.peerConnectionLayer.sendMessageToPeer(targetPeerId, msg);
  }

  /*********************** LOWER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message delivered by the peer connection layer.
   */
  _handlePeerConnLayerMessage(msg) {
    const parsedMsg = JSON.parse(msg);
    log.debug('Handling message from peer connection layer: ', parsedMsg);
    switch (parsedMsg.header.source) {
      case PEER:
        this._peerMessageHandler(parsedMsg.body);
        break;
      case SERVER:
        this._serverMessageHandler(parsedMsg.body);
        break;
      default:
        log.error('Unknown message source: ', msg.source);
        break;
    }
  }

  /**
   * Handler for the body of messages from peers
   */
  _peerMessageHandler(msgBody) {
    let portalBinding;

    if (msgBody.portalHostPeerId === msgBody.senderPeerId) {
      // Message is from a portal host
      portalBinding = this.hostPortalBinding;
    } else {
      // Message is from a portal guest
      portalBinding =
        await this.guestPortalBindings.get(msgBody.portalHostPeerId);
    }
    portalBinding.handleRemoteMessage(msgBody);
  }

  /**
   * Handler for the body of messages from the signalling server
   */
  _serverMessageHandler(msgBody) {
    this.hostPortalBinding.handleRemoteMessage(msgBody);
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
    // Listen to local inserts
    this.hostPortalBinding.onDidLocalInsert(
      this._handleHostPortalMessage.bind(this)
    );
    // Listen to local deletes
    this.hostPortalBinding.onDidLocalDelete(
      this._handleHostPortalMessage.bind(this)
    );
    // Listen to state initialisation messages
    this.hostPortalBinding.onCurrentStateMessageBatches(
      this._handleStateMessageBatches.bind(this)
    );
    // Listen for when the host portal closes
    this.hostPortalBinding.onPortalClosed(
      this._handleClosedHostPortal.bind(this)
    );
    // Listen for when a site ID for a new guest peer is created
    this.hostPortalBinding.onCreatedSiteIdForNewPeer(
      this._handleNewSiteIdForPeer.bind(this)
    )
    // Lisetn to requests to broadcaset a message
    this.hostPortalBinding.onBroadcastMessage(
      this._handleHostPortalMessage.bind(this)
    );
  }

  /**
   * Create a guest portal binding
   */
  createGuestPortalBinding(portalHostPeerId) {
    let info = 'Creating guest portal binding for portal host: ';
    info += portalHostPeerId;
    log.debug(info);

    let numGuestPeers;
    if (this.hostPortalBinding) {
      numGuestPeers = this.hostPortalBinding.getGuestPeerIds().size;
    } else {
      numGuestPeers = 0;
    }

    const props = {
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      portalHostPeerId: portalHostPeerId,
      localPeerId: this.localPeerId,
      siteId: numGuestPeers + 1
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
   * Return the peer ID of the local peer
   */
  getLocalPeerId() {
    return this.localPeerId;
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
  getLocalUsername() {
    return this.username;
  }

  /************************ MISCELLANOUS HELPER FUNCTIONS *********************/

}

module.exports = PortalBindingManager;
