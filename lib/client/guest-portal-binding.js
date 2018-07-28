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

/**
 * Strip the username, if it exists, from the buffer proxy ID.
 */
function _getPortalHostUsernameFromBufferProxyId(bufferProxyId) {
  const [username, rawBufferProxyId] = bufferProxyId.split('/');
  return username;
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
  }

  /*********************** INITIALISATION AND LISTENERS ***********************/

  /**
   * Initialise the guest portal
   */
  initialise() {
    logDebug('Initialised guest portal binding');
  }


  close() {
    logDebug('Closed guest portal binding.');
    this.subscriptions.dispose();
    log(`Peer ${this.localPeerId} left portal ${this.portalHostPeerId}`);
  }

  /**
   * Listen to the specified text buffer proxy
   */
  _listenToBufferProxy(bufferProxy) {
    const id = bufferProxy.getId();
    bufferProxy.onDidEmitMessage(msg => {
      this._handleLocalMessage(msg)
    });
    this.bufferProxiesById.set(id, bufferProxy);
  }

  /******************************* PUBLIC API *********************************/

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

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(msg) {
    logDebug(JSON.stringify(msg, null, '\t'));
    if (msg.type === TEXT_BUFFER_PROXY_INSERT) {

      const {textBufferProxyId, newText, startPos} = msg;
      this._localInsertAndEmitEvent(textBufferProxyId, newText, startPos);

    } else if (msg.type === TEXT_BUFFER_PROXY_DELETE) {

      const {textBufferProxyId, startPos, endPos} = msg;
      this._localDeleteAndEmitEvent(textBufferProxyId, startPos, endPos);

    } else {
      logError(`Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Insert the given characters into the CRDT for the given text-buffer-proxy
   * ID and emit an event.
   */
  async _localInsertAndEmitEvent(textBufferProxyId, characters, startPos) {
    let [_, crdt] = this._getTextBufferProxyAndCRDT(textBufferProxyId);

    let currentPos = Object.assign({}, startPos);

    for (let i = 0; i < characters.length; i++) {
      if (characters[i - 1] === '\n') {
        currentPos.lineIndex++;
        currentPos.charIndex = 0;
      }
      const charObj = await crdt.handleLocalInsert(characters[i], currentPos);

      // Broadcast message to all peers in portal. We emit a message; the portal
      // binding manager should be listening for this message and will know what
      // to do with it.
      const msg = {
        type: INSERT,
        portalHostPeerId: this.localPeerId,
        textBufferProxyId: bufferProxyId,
        charObject: charObj,
      };
      logDebug(JSON.stringify(msg, null, '\t'));
      this.emitter.emit('did-local-insert', msg);
    }
  }

  /**
   * Get the CRDT for the given text-buffer-proxy ID. Delete from the CRDT the
   * characters in the interval [startPos, endPos), and then emit and event.
   */
  async _localDeleteAndEmitEvent(textBufferProxyId, startPos, endPos) {
    let [_, crdt] = this._getTextBufferProxyAndCRDT(textBufferProxyId);

    const deletedCharObjs = await crdt.handleLocalDelete(startPos, endPos);

    // TODO: Investigate opportunities for batch-delete of characters
    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const msg = {
        type: DELETE,
        portalHostPeerId: this.localPeerId,
        textBufferProxyId: textBufferProxyId,
        charObject: charObj,
      };
      logDebug(JSON.stringify(msg, null, '\t'));
      this.emitter.emit('did-local-delete', msg);
    }
  }
  /********************** LOWER-LEVEL MESSAGE HANDLERS ************************/

  /**
   * Handle a message received from a remote peer
   */
  handleRemoteMessage(msg) {
    logDebug(`Received message from remote:`);
    logDebugDir(msg);

    if (msg.type === INSERT) {

      const {type, textBufferProxyId, charObject} = msg;
      this._remoteInsert(textBufferProxyId, charObject);

    } else if (msg.type === DELETE) {

      const {type, textBufferProxyId, charObject} = msg;
      this._remoteDelete(textBufferProxyId, charObject);

    } else if (msg.type === LOCAL_PEER_ID) {

      const {localPeerId} = msg;
      this.localPeerId = localPeerId;
      this.notificationManager.addSuccess('Local Peer ID: ' + localPeerId);

    } else {
      logError(`Unknown remote message type: ${msg.type}`);
    }
  }

  /**
   * Get the CRDT specified by the given text-buffer-proxy ID and then insert
   * the specified character object into the CRDT.
   */
  async _remoteInsert(textBufferProxyId, charObj) {
    let [textBufferProxy, crdt] =
      this._getOrCreateTextBufferProxyAndCRDT(textBufferProxyId);

    // TODO: String-wise insertion in v2
    let [_, insertPos] = await crdt.handleRemoteInsert(charObj);

    const insertionPoint = _convertPositionToPoint(insertPos);
    const charValue = charObj.getValue();
    textBufferProxy.insertIntoTextBuffer(insertionPoint, charValue);
  }

  /**
   * Get the CRDT specified by the given text-buffer-proxy ID and then delete
   * the specified character object from the CRDT.
   */
  async _remoteDelete(textBufferProxyId, charObj) {
    let [textBufferProxy, crdt] =
      this._getOrCreateTextBufferProxyAndCRDT(textBufferProxyId);

    // TODO: We need to add version vectors to CRDT implementation to handle
    // causality (e.g. receiving a deletion before the appropriate insertion
    // message has been received).
    // TODO: Multi-character-object deletion in version 2.
    const startPos = await crdt.handleRemoteDelete(charObj);
    let line = startPos.lineIndex;
    let endPos;

    if (line < crdt.length &&
        startPos.charIndex < crdt.lineArray[line].length) {
      endPos = {lineIndex: line, charIndex: startPos.charIndex + 1};
    } else {
      endPos = {lineIndex: line + 1, charIndex: 0};
    }

    const deletionRange = _convertPositionsToRange(startPos, endPos);
    textBufferProxy.deleteFromTextBuffer(deletionRange);
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
      const username = _getPortalHostUsernameFromBufferProxyId(bufferProxyId);
      // Need to save buffer
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

}
