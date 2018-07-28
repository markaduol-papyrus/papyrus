'use babel';

const {CompositeDisposable, Emitter, Point, Range} = require('atom');
const TextBufferProxy = require('./text-buffer-proxy.js');
const MessageTypes = require('./message-types.js');

// CRDT
const PapyrusCRDT = require('papyrus-crdt');
const CRDT = PapyrusCRDT.CRDT;
const Identifier = PapyrusCRDT.Identifier;
const Char = PapyrusCRDT.Char;

// Message Types from Text Buffer Proxy and Portal Binding Manager
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;
const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;
const INSERT = MessageTypes.INSERT;
const DELETE = MessageTypes.DELETE;

///////////////////////////// ERRORS AND LOGGING ///////////////////////////////
import config from './../../config.js';

function logError(message) {
  console.error('GUEST PORTAL: ' + message);
}

function log(message) {
  console.log('GUEST PORTAL: ' + message);
}

function logDebug(message) {
  if (config.debug) log(message);
}

function logDebugDir(message) {
  if (config.debug) console.dir(message);
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

/**
 * Convert the given position to an atom `Point` object
 */
function _convertPositionToPoint(position) {
  return new Point(position.lineIndex, position.charIndex);
}
////////////////////////////////////////////////////////////////////////////////

/**
 * For every guest portal which this peer is connected to, we assign a singal
 * text editor and pane for that portal.
 * The text buffer attached to the text editor of this guest portal binding,
 * depends on which text buffer is currently attached to the active text editor
 * at the portal host.
 */
class GuestPortalBinding {
  constructor({workspace, notificationManager, portalHostPeerId, localPeerId}) {
    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.portalHostPeerId = portalHostPeerId;
    this.localPeerId = localPeerId;
    this.emitter = new Emitter();
    this.bufferProxiesById = new Map();
    this.crdtsById = new Map();
    this.bufferURIs = new Set();
    this.subscriptions = new CompositeDisposable();
    this.initialise();
  }

  /*********************** INITIALISATION AND LISTENERS ***********************/

  /**
   * Initialise the guest portal
   */
  initialise() {
    logDebug('Initialised guest portal binding');
  }

  /**
   * Populate the CRDT structure of the given text buffer proxy.
   */
  _populateCRDT(textBufferProxy) {
    return new Promise((resolve) => {
      let crdt = new CRDT(this.siteId);
      let lines = textBufferProxy.getBuffer().getLines();
      let char;
      let position;

      for (let i = 0; i < lines.length; i++) {
        for (let j = 0; j <= lines[i].length; j++) {
          if (j === lines[i].length) {
            char = '\n';
          } else {
            char = lines[i][j];
          }
          position = {lineIndex: i, charIndex: j};
          crdt.handleLocalInsert(char, position);
        }
      }
      resolve(crdt);
    });
  }

  close() {
    logDebug('Closed guest portal binding.');
    this.subscriptions.dispose();
  }

  /**
   * Listen to the specified text buffer proxy
   */
  listenToBufferProxy(bufferProxy) {
    const id = bufferProxy.getId();
    bufferProxy.onDidEmitMessage(msg => {
      this._handleLocalMessage(msg)
    });
    this.bufferProxiesById.set(id, bufferProxy);
  }

  /*********************** PUBLIC API FOR OBSERVERS ***************************/

  onDidLocalInsert(callback) {
    this.emitter.on('did-local-insert', callback);
  }

  onDidLocalDelete(callback) {
    this.emitter.on('did-local-delete', callback);
  }

  onPeerJoined(callback) {
    this.emitter.on('joined-portal', callback);
  }

  onPeerLeft(callback) {
    this.emitter.on('left-portal', callback);
  }

  /**** MESSAGE HANDLERS FROM LOWER- AND HIGHER-LEVEL MODULES RESPECTIVELY ****/

  /**
   * Handle a message received from a remote peer (delivered by the portal
   * binding manager)
   */
  handleRemoteMessage(msg) {
    logDebug(`Received message from remote:`);
    logDebugDir(msg);

    if (msg.type === INSERT) {

      const {type, textBufferProxyId, charObject} = msg;
      this._remoteInsert(textBufferProxyId, charObject);

    } else if (msg.type === DELETE) {

      const {type, textBufferProxyId}
    }
  }

  /****************************** MISCELLANOUS ********************************/

  /**
   * Return the TextBufferProxy and CRDT referenced by the given ID, or create
   * them if neither exists.
   */
  async _getOrCreateTextBufferProxyAndCRDT(bufferProxyId) {
    if (!this.crdtsById.has(bufferProxyId) ||
        !this.bufferProxiesById.has(bufferProxyId)) {

      let buffer = new TextBuffer();
      let bufferProxy = new TextBufferProxy(textBuffer);
      const crdt = await this._populateCRDT(bufferProxy);

      this.crdtsById.set(bufferProxyId, crdt);
      this.bufferProxiesById.set(bufferProxyId, bufferProxy);

      return [bufferProxy, crdt];

    } else {

      const crdt = this.crdtsById.get(bufferProxyId);
      const bufferProxy = this.bufferProxiesById.get(bufferProxyId);
      return [bufferProxy, crdt];

    }
  }

}
