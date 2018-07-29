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
const config = require('./../../config.js')
const log = require('loglevel').getLogger('host-portal-binding');
log.setLevel(config.logLevels.models);

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
    this.subscriptions = new CompositeDisposable();
    this.localPeerId;  // Also serves as the host portal ID
    this.emitter = new Emitter();
    this.guestPeerIds = new Set();
  }

  /*********************** INITIALISATION AND LISTENERS ***********************/

  /**
   * Initialise the portal
   */
  initialise() {
    log.debug('Initialising host portal...');
    this.subscriptions.add(
      // Observe the buffer of the active text editor
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
          this._listenToBufferProxy(bufferProxy);
        }
      })
    );
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
    log.debug('Closing host portal...');
    this.subscriptions.dispose();
    this.emitter.emit('closed-portal');
  }

  /**
   * Listen to the specified text editor proxy
   */
  _listenToEditorProxy(editorProxy) {
    const id = editorProxy.getId();
    this.editorProxiesById.set(id, editorProxy);
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
    this.emitter.on('peer-joined', callback);
  }

  onPeerLeft(callback) {
    this.emitter.on('peer-left', callback);
  }

  onPortalClosed(callback) {
    this.emitter.on('closed-portal', callback);
  }

  onCurrentStateMessageBatches(callback) {
    this.emitter.on('current-state-message-batches', callback);
  }

  async peerDidJoin(guestPeerId) {
    this.notificationManager.addInfo(
      `Peer ${guestPeerId} has joined your portal.`
    );
    this.guestPeerIds.add(guestPeerId);
    await this._sendCurrentStateToNewPeer(guestPeerId)
    this.emitter.emit('peer-joined', guestPeerId);
  }

  peerDidLeave(guestPeerId) {
    this.notificationManager.addInfo(
      `Peer ${guestPeerId} has left your portal.`
    );
    this.guestPeerIds.delete(guestPeerId);
    this.emitter.emit('peer-left', guestPeerId);
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(msg) {
    if (msg.type === TEXT_BUFFER_PROXY_INSERT) {

      const {textBufferProxyId, newText, startPos} = msg;
      this._localInsertAndEmitEvent(textBufferProxyId, newText, startPos);

    } else if (msg.type === TEXT_BUFFER_PROXY_DELETE) {

      const {textBufferProxyId, startPos, endPos} = msg;
      this._localDeleteAndEmitEvent(textBufferProxyId, startPos, endPos);

    } else {
      log.error('Unknown message type: ', msg.type);
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
        textBufferProxyId: textBufferProxyId,
        charObject: charObj,
        targetPeerIds: this.guestPeerIds,
      };
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
        targetPeerIds: this.guestPeerIds,
      };
      this.emitter.emit('did-local-delete', msg);
    }
  }

  /********************** LOWER-LEVEL MESSAGE HANDLERS ************************/

  /**
   * Handle a message from a remote peer
   */
  handleRemoteMessage(msg) {
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
      log.error('Unknown message type: ', msg.type);
    }
  }

  /**
   * Get the CRDT specified by the given text-buffer-proxy ID and then insert
   * the specified character object into the CRDT.
   */
  async _remoteInsert(textBufferProxyId, charObj) {
    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

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

  /**
   * For every text-buffer-proxy that this portal host is listening to, we send
   * obtain the CRDT for that text-buffer-proxy and send the current state of
   * the CRDT to the specified peer ID.
   */
  _sendCurrentStateToNewPeer(targetPeerId) {
    let messageBatches = [];
    let messageBatch = [];
    // Arbitrary
    const messageBatchSize = 16;

    for (const [id, crdt] of this.crdstById) {
      let lineArray = crdt.getLineArray();

      for (let i = 0; i < lineArray.length; i++) {
        for (let j = 0; j < lineArray[i].length; j++) {
          const charObj = lineArray[i][j];
          const msg = {
            type: INSERT,
            portalHostPeerId: this.localPeerId,
            textBufferProxyId: id,
            charObject: charObj,
          };
          messageBatch.push(msg);
          if (messageBatch.length % messageBatchSize === 0) {
            messageBatches.push(Object.assign([], messageBatch));
            messageBatch = [];
          }
        }
      }
    }

    if (messageBatch.length > 0) {
      messageBatches.push(Object.assign([], messageBatch));
      messageBatch = [];
    }

    const msg = {
      targetPeerId: targetPeerId,
      messageBatches: messageBatches,
    };
    this.emitter.emit('current-state-message-batches', msg);
  }

  getGuestPeerIds() {
    return this.guestPeerIds;
  }

  getPeerId() {
    return this.localPeerId;
  }

  /**
   * Return the TextBufferProxy and CRDT referenced by the given ID.
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
}

module.exports = HostPortalBinding;
