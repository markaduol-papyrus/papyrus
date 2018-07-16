'use babel';

import { Emitter } from 'atom';
import HostPortalBinding from './host-portal-binding.js';
const uuid = require('uuid/v1');
const MessageTypes = require('./message-types.js');
const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;
const DATA_CHANNEL_MESSAGE = MessageTypes.DATA_CHANNEL_MESSAGE;

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
////////////////////////////////////////////////////////////////////////////////

class PortalBindingManager {
  constructor(options) {
    this.emitter = new Emitter();
    // Unique site ID for this peer (private; used by CRDT)
    this.siteId = uuid();
    // Unique local peer ID assigned by signaling server (this is the ID that
    // will be shared with remote peers when they wish to connect the portal
    // hosted by "this" peer)
    this.localPeerId;
    // Peer connection layer abstraction used to handle network connections
    this.peerConnectionLayer;
    // Host portal binding
    this.hostPortalBinding;
    // Guest portal binding
    this.guestPortalBindings = new WeakMap();
    this.workspace = options.workspace;
    this.notificationManager = options.notificationManager;
  }

  /**
   * Initialise the portal binding manager
   */
  initialise() {

  }

  /**
   * Used by external modules to register functions to be executed when the
   * portal binding manager emits a message.
   */
  onDidEmitMessage(callback) {
    this.emitter.on('did-emit-message', callback);
  }

  handlePeerConnLayerMessage(msg) {
    if (msg.type === LOCAL_PEER_ID) {
      log(`Local Peer ID "${msg.localPeerId}" delivered.`);
      this.localPeerId = msg.localPeerId;
    } else if (msg.type === DATA_CHANNEL_MESSAGE) {
      const parsedData = JSON.parse(msg.data);

    }
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
    logDebug('Adding event handlers on host portal');
    this.hostPortalBinding.onDidLocalInsert(
      this._handleHostPortalMessage.bind(this)
    );
    this.hostPortalBinding.onDidLocalDelete(
      this._handleHostPortalMessage.bind(this)
    );
    return this.hostPortalBinding;
  }

  /**
   * Handle a message received from the host portal binding.
   */
  _handleHostPortalMessage(message) {
    // Need to inspect portal ID of message and tell peer conn. layer to send
    // the message to every peer in the portal.
  }
}

module.exports = PortalBindingManager;
