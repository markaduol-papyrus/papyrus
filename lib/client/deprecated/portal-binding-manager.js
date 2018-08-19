'use babel';

const {Emitter, Range} = require('atom');
const HostPortalBinding = require('./host-portal-binding.js');
const GuestPortalBinding = require('./guest-portal-binding.js');
const PeerConnectionLayer = require('./peer-connection-layer.js');
const {ANIMALS, ADJECTIVES} = require('./default-usernames.js');
const uuid = require('uuid/v1');
const MessageTypes = require('./message-types.js');
const MessageBuilder = require('./message-builder');
const {serializeMessage, deserializeMessage} = require('./message-serializer');

// Message types
const JOIN_PORTAL_REQUEST = MessageTypes.JOIN_PORTAL_REQUEST;
const DATA_CHANNEL_MESSAGE = MessageTypes.DATA_CHANNEL_MESSAGE;
const NOTIFICATION = MessageTypes.NOTIFICATION;
const PEER = MessageTypes.PEER;
const SERVER = MessageTypes.SERVER;

// Logging
const log = require('loglevel').getLogger('portal-binding-manager');
const config = require('./../config.js')
log.setLevel(config.logLevels.models);

/** HELPER FUNCTIONS **/

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

/** EXCEPTIONS **/

function InvalidMessageFromPeerConnectionLayer(message) {
  this.message = message || '';
  this.name = 'InvalidMessageFromPeerConnectionLayer';
}
InvalidMessageFromPeerConnectionLayer.prototype = Error.prototype;

// NOTE: All messages sent by the PortalBindingManager to the
// PeerConnectionLayer should be unserialized

/** CORE CODE **/

class PortalBindingManager {
  /**
   * Expected parameters
   * @param {Object} workspace Atom workspace
   * @param {Object} notificationManager Atom notification manager
   */
  constructor(props) {
    log.debug('Constructing PortalBindingManager', props);
    const {workspace, notificationManager} = props;

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
    // List of peer IDs to which the local peer has a connection
    this.connectedPeers = new Set();
  }


  /**
   * Initialise the portal binding manager.
   */
  async initialise() {
    log.debug('Initialising PortalBindingManager.');
    if (!this.peerConnectionLayer) {
      this.peerConnectionLayer = await this.getOrCreatePeerConnectionLayer();
    }
    // Tell portal binding manager to listen to messages from peer conn. layer
    await this.peerConnectionLayer.onDidEmitMessage(
      this._handlePeerConnectionLayerMessage.bind(this)
    );
  }

  /**
   * Establish a WebRTC connection to the given peer
   */
  async connectToPeer(targetPeerId) {
    const logObj = {targetPeerId: targetPeerId};
    log.debug('Connecting to peer: ', logObj);

    if (!this.peerConnectionLayer) {
      await this.initialise();
    }
    const peerId = this.peerConnectionLayer.connectToPeer(targetPeerId);
    this.connectedPeers.add(peerId);
  }

  /**
   * Send the given (unserialized) message to the given peer
   */
  async sendMessageToPeer(msg, targetPeerId) {
    const logObj = {message: msg, targetPeerId: targetPeerId};
    log.debug('Sending message to peer: ', logObj);

    const peerConnectionLayer = await this.getOrCreatePeerConnectionLayer();
    peerConnectionLayer.sendMessageToPeer(msg, targetPeerId);
  }

  /****************** FUNCTIONS TO REGISTER EVENT LISTENERS *******************/

  /**
   * The View classes are the main classes that subscribe to these events.
   * Classes higher in the layered model architecture should not subscribe
   * to these events, as that would introduce cyclic dependencies.
   */

  onPortalsStatusChange(callback) {
    return this.emitter.on('portals-status-change', callback);
  }

  onCreatedHostPortal(callback) {
    return this.emitter.on('created-host-portal', callback);
  }

  onClosedHostPortal(callback) {
    return this.emitter.on('closed-host-portal', callback);
  }

  onJoinedGuestPortal(callback) {
    return this.emitter.on('joined-guest-portal', callback);
  }

  onLeftGuestPortal(callback) {
    return this.emitter.on('left-guest-portal', callback);
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a message received from the host portal binding.
   */
  _broadcastHostPortalMessage(message) {
    const logObj = {message: message};
    log.debug('Broadcasting message from host portal binding: ', logObj);

    const {targetPeerId, targetPeerIds} = message.header;
    if (targetPeerId) {
      this.peerConnectionLayer.sendMessageToPeer(message, targetPeerId);
    } else {
      for (const peerId of targetPeerIds) {
        this.peerConnectionLayer.sendMessageToPeer(message, peerId);
      }
    }
  }

  /**
   * Handle an (unserialized) message received from a guest portal binding
   */
  _broadcastGuestPortalMessage(message) {
    const logObj = {message: message};
    log.debug('Broadcasting message from guest portal binding: ', logObj);

    this.peerConnectionLayer.sendMessageToPeer(
      message, message.header.portalHostPeerId
    );
  }

  /**
   * Send the message batches to the given target peer ID.
   */
  _broadcastHostPortalMessageBatches(messageBatches) {
    const logObj = {targetPeerId: targetPeerId, messageBatches: messageBatches};
    log.debug('Broadcasting message batches: ', logObj);

    for (let i = 0; i < messageBatches.length; i++) {
      const msg = serializeMessage(messageBatches[i]);
      this.peerConnectionLayer.sendMessageToPeer(msg, targetPeerId);
    }
  }

  /**
   * Handler for when the host portal signals that it has closed
   */
  _handleClosedHostPortal() {
    log.debug('Handling closed host portal binding.');
    this.hostPortalBinding = null;
    this.emitter.emit('closed-host-portal');
    this.emitter.emit('portals-status-change');
  }

  /**
   * Handler for when the local peer has opened a guest portal binding (and
   * hence, joined a portal as a guest)
   */
  _handleOpenedGuestPortalBinding({portalHostPeerId, portalBinding}) {
    const logObj = {
      portalHostPeerId: portalHostPeerId,
      portalBinding: portalBinding,
    };
    log.debug('Handling opened guest portal binding: ', logObj);

    this.guestPortalBindings.set(portalHostPeerId, portalBinding);
    const myEvent = {portalHostPeerId: portalHostPeerId};
    this.emitter.emit('joined-guest-portal', myEvent);
    this.emitter.emit('portals-status-change');
  }

  /**
   * Handler for when guest portal signals that it has closed
   */
  _handleClosedGuestPortalBinding(portalHostPeerId) {
    const logObj = {portalHostPeerId: portalHostPeerId};
    log.debug('Handling closed guest portal binding: ', logObj);

    if (!this.guestPortalBindings) {
      log.error('No reference to guest portal bindings');
      return;
    }
    if (!this.guestPortalBindings.has(portalHostPeerId)) {
      const logObj = {portalHostPeerId: portalHostPeerId};
      log.error(
        'Guest portal binding connected to portal host does not exist: ', logObj
      );
      return;
    }
    this.guestPortalBindings.delete(portalHostPeerId);
    const myEvent = {portalHostPeerId: portalHostPeerId};
    this.emitter.emit('left-guest-portal', myEvent);
    this.emitter.emit('portals-status-change');
  }

  /*********************** LOWER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Do context-agnostic checks on the message from the peer connection layer.
   */
  _validatePeerConnectionLayerMessage(message) {
    const logObj = {message: message};
    log.debug('Validating message from peer connection layer: ', logObj);

    // We do context-agnostic checks on the message header; it is assumed that
    // the peer connection layer has already done context-agnostic checks on the
    // message body.
    let invalidMessageHeader = false;
    let errorMessage;
    if (!message.header || !message.header.source) {
      invalidMessageHeader = true;
      errorMessage = 'Invalid message header: ';
    }
    if (invalidMessageHeader) {
      errorMessage += JSON.stringify(logObj);
      log.error(errorMessage);
      throw new InvalidMessageFromPeerConnectionLayer(errorMessage);
    }
    return message;
  }

  /**
   * Handle a message delivered by the peer connection layer.
   */
  _handlePeerConnectionLayerMessage(message) {
    const logObj = {message: message};
    log.debug('Handling message from peer connection layer: ', logObj);

    const peerConnectionLayerMessage =
      this._validatePeerConnectionLayerMessage(message);
    switch (peerConnectionLayerMessage.header.source) {
      case PEER:
        this._peerMessageHandler(peerConnectionLayerMessage.body);
        break;
      case SERVER:
        this._serverMessageHandler(peerConnectionLayerMessage.body);
        break;
      default:
        log.error(
          'Unknown message source: ', peerConnectionLayerMessage.source
        );
        throw new InvalidMessageFromPeerConnectionLayer(JSON.stringify(logObj));
    }
  }

  /**
   * Handler for the body of messages from peers
   */
  async _peerMessageHandler(message) {
    log.debug('Running peer message handler: ', {message: message});

    // TODO: This logic here needs to be changed such that we only examine the
    // message header. This is because the PortalBindingManager is not
    // permitted to do any data validation checks (whether context-agnostic or
    // context-specific) on the message body. That is handled by the higher
    // layers.
    let portalBinding;
    const {header} = message;
    if (header.portalHostPeerId === header.senderPeerId) {
      // Message is from a portal host, so the local peer is a guest of that
      // portal
      portalBinding =
        await this.guestPortalBindings.get(header.portalHostPeerId);
    } else {
      // Message is from a portal guest, so the local peer is the host of the
      // portal.
      portalBinding = this.hostPortalBinding;
    }
    portalBinding.handleRemoteMessage(message);
  }

  /**
   * Handler for the body of messages from the signalling server
   */
  _serverMessageHandler(message) {
    // All messages from the signalling server are handled by the host portal
    this.hostPortalBinding.handleRemoteMessage(message);
  }

  /*************************** GETTERS AND CREATERS ***************************/

  /**
   * Get or create a host-portal binding
   */
  async createAndInitialiseHostPortalBinding() {
    log.debug('Creating host portal binding.');
    if (this.hostPortalBinding) this.hostPortalBinding = null;

    this.hostPortalBinding = new HostPortalBinding({
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      username: this.username
    });
    // Add event handlers
    this._addHostPortalEventHandlers();

    // Initialise host portal binding
    await this.hostPortalBinding.initialise();

    const myEvent = {hostPortalBinding: this.hostPortalBinding};
    this.emitter.emit('created-host-portal', myEvent);
    this.emitter.emit('portals-status-change');
    return this.hostPortalBinding;
  }

  _addHostPortalEventHandlers() {
    // Listen to delivery of local peer ID
    this.hostPortalBinding.onDeliveredLocalPeerId(({localPeerId}) => {
      const logObj = {localPeerId: localPeerId};
      log.debug('Host portal binding delivered local peer ID: ', logObj);
      this.localPeerId = localPeerId;
    });
    // Listen to messages intended to be parsed by the signalling server
    this.hostPortalBinding.onCreatedMessageForServer((msg) => {
      this.peerConnectionLayer.sendToServer(msg);
    })
    // Listen to local inserts
    this.hostPortalBinding.onDidLocalInsert(
      this._broadcastHostPortalMessage.bind(this)
    );
    // Listen to local deletes
    this.hostPortalBinding.onDidLocalDelete(
      this._broadcastHostPortalMessage.bind(this)
    );
    this.hostPortalBinding.onEnqueueMessage(
      this._broadcastHostPortalMessage.bind(this)
    )
    // Listen to state queueing of message batches
    this.hostPortalBinding.onEnqueueMessageBatches(({messageBatches}) => {
      this._broadcastHostPortalMessageBatches(messageBatches);
    });
    // Listen for when the host portal closes
    this.hostPortalBinding.onPortalClosed(
      this._handleClosedHostPortal.bind(this)
    );
    // Listen to acceptances of a "join-portal" request
    this.hostPortalBinding.onAcceptedJoinPortalRequest(
      this._broadcastHostPortalMessage.bind(this)
    );
    this.hostPortalBinding.onAcceptedLeavePortalRequest(
      this._broadcastHostPortalMessage.bind(this)
    );
  }

  async createAndInitialiseGuestPortalBinding(portalHostPeerId) {
    const logObj = {portalHostPeerId: portalHostPeerId};
    log.debug('Creating guest portal binding to portal host: ', logObj);

    if (!this.connectedPeers.has(portalHostPeerId)) {
      await this.connectToPeer(portalHostPeerId);
    }
    const props = {
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      portalHostPeerId: portalHostPeerId,
      localPeerId: this.localPeerId,
      username: this.username,
    };
    const guestPortalBinding = new GuestPortalBinding(props);
    this.guestPortalBindings.set(portalHostPeerId, guestPortalBinding);
    await this._addGuestPortalEventHandlers(guestPortalBinding);
    await guestPortalBinding.initialise();
    return guestPortalBinding;
  }

  _addGuestPortalEventHandlers(portalBinding) {
    // Joining/Leaving of portal

    // Listen to request to join portal
    portalBinding.onJoinPortalRequest(
      this._broadcastGuestPortalMessage.bind(this)
    );

    // Listen to confirmation that host has accepted a "join portal" request
    portalBinding.onHostAcceptedJoinPortalRequest((props) => {
      log.debug('Portal host accepted join request: ', props);

      const {portalHostPeerId} = props;
      const msg = new MessageBuilder().
                  setPortalHostPeerId(portalHostPeerId).
                  setPortalBinding(portalBinding).
                  getResult();
      this.emitter.emit('joined-guest-portal', msg);
    });

    // Listen to request to leave portal
    portalBinding.onLeavePortalRequest((props) => {
      this._broadcastGuestPortalMessage.bind(this)
    });

    // Listen to confirmation that host has accepted "leave portal" request
    portalBinding.onHostAcceptedLeavePortalRequest((props) => {
      log.debug('Portal host accepted leave request: ', props);

      const {portalHostPeerId} = props;
      this.guestPortalBindings.delete(portalHostPeerId);
      const msg = new MessageBuilder().
                  setPortalHostPeerId(portalHostPeerId).
                  setPortalBinding(portalBinding).
                  getResult();
      this.emitter.emit('left-guest-portal', msg);
    });

    // Listen to when the guest portal binding has accepted the site ID
    // assigned by the host
    portalBinding.onAcceptedSiteId(
      this._broadcastGuestPortalMessage.bind(this)
    )

    // Text updates

    // Listen to local inserts
    portalBinding.onDidLocalInsert(
      this._broadcastGuestPortalMessage.bind(this)
    );

    // Listen to local deletes
    portalBinding.onDidLocalDelete(
      this._broadcastGuestPortalMessage.bind(this)
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
