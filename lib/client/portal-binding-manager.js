const uuid = require('uuid/v1');
const MessageTypes = require('./message-types.js');

// For TextBufferProxy
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;
const DATA_CHANNEL_MESSAGE = MessageTypes.DATA_CHANNEL_MESSAGE;
const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;

///////////////////////////// ERRORS AND LOGGING ///////////////////////////////
function logError(message) {
  console.error('CONTROLLER: ' + message);
}

function log(message) {
  console.log('CONTROLLER: ' + message);
}

function NonExistentCRDTException(message) {
  this.name = 'NonExistentCRDTException';
  this.message = message || '';
}
NonExistentCRDTException.prototype = Error.prototype;

function NonExistentTextBufferProxyException(message) {
  this.name = 'NonExistentTextBufferProxyException';
  this.message = message || '';
}
NonExistentTextBufferProxyException.prototype = Error.prototype;
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
  constructor() {
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




}
