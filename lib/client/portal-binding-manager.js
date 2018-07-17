'use babel';

import { Emitter } from 'atom';
import HostPortalBinding from './host-portal-binding.js';
import PeerConnectionLayer from './peer-connection-layer.js';
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
    // Unique local peer ID assigned by signaling server (this is the ID that
    // will be shared with remote peers when they wish to connect the portal
    // hosted by "this" peer)
    this.localPeerId;
    // Peer connection layer abstraction used to handle network connections
    this.peerConnectionLayer;
    // Host portal binding
    this.hostPortalBinding;
    // Guest portal binding
    this.guestPortalBindings = new Map();
    this.workspace = options.workspace;
    this.notificationManager = options.notificationManager;
  }

  /**
   * Initialise the portal binding manager.
   */
  async initialise() {
    if (!this.peerConnectionLayer) {
      await this.getOrCreatePeerConnectionLayer();
    }
    // Tell portal binding manager to listen to messages from peer conn. layer
    logDebug('Adding event handlers on peer connection layer');
    await this.peerConnectionLayer.onDidEmitMessage(
      this._handlePeerConnLayerMessage.bind(this)
    );
  }

  /**
   * Handle a message received from the host portal binding.
   */
  _handleHostPortalMessage(message) {
    // Need to inspect portal ID of message and tell peer conn. layer to send
    // the message to every peer in the portal.
    const msg = {
      type: message.type,
      portalId: message.portalId,
      textBufferProxyId: message.textBufferProxyId,
      charObject: message.charObject,
      senderPeerId: this.localPeerId,
    }
    for (const targetPeerId of message.targetPeerIds) {
      this.peerConnectionLayer.sendMessageToPeer(msg, targetPeerId);
    }
  }

  _handlePeerConnLayerMessage(msg) {
    if (msg.type === LOCAL_PEER_ID) {

      log(`Local Peer ID "${msg.localPeerId}" delivered.`);
      this.localPeerId = msg.localPeerId;

    } else if (msg.type === DATA_CHANNEL_MESSAGE) {

      // Message received over data channel
      const payload = JSON.parse(msg.data);
      if (!payload.portalId) {
        logError(`Message ${msg} contains no portal ID`);
        return;
      }

      if (payload.portalId === this.localPeerId) {
        // Message received from remote peer which is connected to the portal
        // hosted by this peer
        this.hostPortalBinding.handleRemoteMessage(payload);
        // Due to star network topology (with portal host at centre), we need to
        // forward the message to all guest peers other than the sender
        for (const guestPeerId of this.hostPortalBinding.getGuestPeerIds()) {
          if (guestPeerId !== payload.senderPeerId) {
            this.peerConnectionLayer.sendMessageToPeer(guestPeerId, msg);
          }
        }
      } else {
        // "this" peer is a guest of the portal referenced by payload.portalId
        const guestPortalBinding =
          this.guestPortalBindings.get(payload.portalId);
        guestPortalBinding.handleRemoteMessage(payload);
      }
    }
  }

  /*************************** GETTERS AND CREATERS ***************************/

  getHostPortalBinding() {
    return this.hostPortalBinding;
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
   * Create a peer connection layer
   */
  async getOrCreatePeerConnectionLayer() {
    if (this.peerConnectionLayer) return this.peerConnectionLayer;
    this.peerConnectionLayer = new PeerConnectionLayer();
    await this.peerConnectionLayer.initialise();
    return this.peerConnectionLayer;
  }

}

module.exports = PortalBindingManager;
