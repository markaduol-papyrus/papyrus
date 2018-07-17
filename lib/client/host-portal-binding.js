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
  console.error('HOST PORTAL: ' + message);
}

function log(message) {
  console.log('HOST PORTAL: ' + message);
}

function logDebug(message) {
  if (config.debug) log(message);
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

class HostPortalBinding {
  constructor({workspace, notificationManager}) {
    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.bufferProxiesById = new Map();
    this.crdtsById = new Map();
    this.bufferURIs = new Set();
    this.disposables = new CompositeDisposable();
    this.localPeerId;  // Also serves as the host portal ID
    this.emitter = new Emitter();
    this.guestPeerIds = new Set();
  }

  /*********************** INITIALISATION AND LISTENERS ***********************/

  /**
   * Initialise the host portal
   */
  initialise() {
    this.disposables.add(
      this.workspace.observeActiveTextEditor(async editor => {
        let textBuffer = editor.getBuffer();
        let uri = textBuffer.getUri();

        if (!this.bufferURIs.has(uri)) {
          this.bufferURIs.add(uri);

          let bufferProxy = new TextBufferProxy(textBuffer);
          let crdt = await this._populateCRDT(bufferProxy);
          const bufferProxyId = bufferProxy.getId();

          this.crdtsById.set(bufferProxyId, crdt);
          await bufferProxy.initialise();
          this.bufferProxiesById.set(bufferProxyId, bufferProxy)
          this.listenToBufferProxy(bufferProxy);
        }
      })
    );
    logDebug('Initialised host portal binding.');
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
    logDebug('Closed host portal binding.');
    this.disposables.dispose();
  }

  /**
   * Listen to the specified text editor proxy
   */
  listenToEditorProxy(editorProxy) {
    const id = editorProxy.getId();
    this.editorProxiesById.set(id, editorProxy);
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

  /******** MESSAGE HANDLERS FROM BOTH HIGHER- AND LOWER-LEVEL MODULES ********/

  handleRemoteMessage(msg) {
    if (msg.type === INSERT) {

      let {type, textBufferProxyId, charObject} = msg;
      this._remoteInsert(textBufferProxyId, charObject);

    } else if (msg.type === DELETE) {

      let {type, textBufferProxyId, charObject} = msg;
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
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(msg) {
    logDebug(JSON.stringify(msg, null, '\t'));
    if (msg.type === TEXT_BUFFER_PROXY_INSERT) {

      const {textBufferProxyId, newText, startPos} = msg;
      this._localInsertAndBroadcast(textBufferProxyId, newText, startPos);

    } else if (msg.type === TEXT_BUFFER_PROXY_DELETE) {

      const {textBufferProxyId, startPos, endPos} = msg;
      this._localDeleteAndBroadcast(textBufferProxyId, startPos, endPos);

    } else {
      logError(`Unknown message type: ${msg.type}`);
    }
  }

  /**************** HANDLING LOCALLY-GENERATED TEXT UPDATES *******************/

  async _localInsertAndBroadcast(textBufferProxyId, characters, startPos) {
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
        portalId: this.localPeerId,
        textBufferProxyId: textBufferProxyId,
        charObject: charObj,
        targetPeerIds: this.guestPeerIds,
      };
      logDebug(JSON.stringify(msg, null, '\t'));
      this.emitter.emit('did-local-insert', msg);
    }
  }

  async _localDeleteAndBroadcast(textBufferProxyId, startPos, endPos) {
    let [_, crdt] = this._getTextBufferProxyAndCRDT(textBufferProxyId);

    const deletedCharObjs = await crdt.handleLocalDelete(startPos, endPos);

    // TODO: Investigate opportunities for batch-delete of characters
    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const msg = {
        type: DELETE,
        portalId: this.localPeerId,
        textBufferProxyId: textBufferProxyId,
        charObject: charObj,
        targetPeerIds: this.guestPeerIds,
      };
      logDebug(JSON.stringify(msg, null, '\t'));
      this.emitter.emit('did-local-delete', msg);
    }
  }

  /*************** HANDLING REMOTELY-GENERATED TEXT UPDATES *******************/

  async _remoteInsert(textBufferProxyId, charObj) {
    // TODO: If 'textBufferProxyId' does not exist, we need to create a new text
    // buffer proxy with an ID based on 'textBufferProxyId' a
    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

    // TODO: String-wise insertion in v2
    let [_, insertPos] = await crdt.handleRemoteInsert(charObj);

    const insertionPoint = _convertPositionToPoint(insertPos);
    const charValue = charObj.getValue();
    textBufferProxy.insertIntoTextBuffer(insertionPoint, charValue);
  }

  async _remoteDelete(textBufferProxyId, charObj) {
    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

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

  /******************************** MISCELLANOUS ******************************/

  getGuestPeerIds() {
    return this.guestPeerIds;
  }

  /**
   * Return the TextBufferProxy and CRDT referenced by the given ID
   */
  _getTextBufferProxyAndCRDT(textBufferProxyId) {
    let crdt = this.crdtsById.get(textBufferProxyId);
    let textBufferProxy = this.bufferProxiesById.get(textBufferProxyId);

    if (!crdt) {
      let errMessage;

      if (!textBufferProxy) {
        errMessage = 'Trying to insert into CRDT of a non-existent ';
        errMessage += 'TextBufferProxy: ' + textBufferProxyId;
        throw new Error(errMessage);
      } else {
        errMessage = 'Expected CRDT for TextBufferProxy ';
        errMessage += `"${textBufferProxyId}" to exist, but it does not.`;
        throw new NonExistentCRDTException(errMessage);
      }
    }

    if (!textBufferProxy) {
      let errMessage = `Expected TextBufferProxy "${textBufferProxyId}"`;
      errMessage += ' to exist, but it does not.';
      throw new NonExistentTextBufferProxyException(errMessage);
    }
    return [textBufferProxy, crdt];
  }

  _constructURI() {

  }
}

module.exports = HostPortalBinding;
