TextBufferProxy'use babel';

const uuid = require('uuid/v1');
const PeerConnectionLayer = require('./peer-connection-layer.js');
const MessageTypes = require('./message-types.js');

// CRDT
const PapyrusCRDT = require('papyrus-crdt');
const CRDT = PapyrusCRDT.CRDT;
const Identifier = PapyrusCRDT.Identifier;
const Char = PapyrusCRDT.Char;

// For TextBufferProxy
const Constants = require('./constants.js');
const TEXT_BUFFER_PROXY_INSERT = Constants.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = Constants.TEXT_BUFFER_PROXY_DELETE;

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

class Controller {
  constructor() {
    // Unique siteId for peer
    this.siteId = uuid();
    // Two hashmaps of text buffer proxies and associated CRDT data structure,
    // both keyed by the ID of the textBufferProxy
    this.textBufferProxies = new Map();
    this.crdts = new Map();
  }

  /**
   * Add a TextBufferProxy class to the Controller, so that the Controller can
   * update it based on remote events.
   */
  addTextBufferProxy(textBufferProxy) {
    let id = textBufferProxy.getId();
    this.textBufferProxies.set(id, textBufferProxy);
    log('Creating CRDT data structure for text buffer: ' + id);
    // TODO: Populate CRDT to account for current state of text buffer
    this.crdts.set(id, new CRDT(this.siteId));
  }

  /**
   * Controller implements "observer" interface; this function should be called
   * by any "observable" to which the Controller has subscribed.
   */
  notify(msg) {
    if (msg.type === TEXT_BUFFER_PROXY_INSERT) {
      const {textBufferProxyId, newText, startPos} = msg;
      this.localInsertAndBroadcast(textBufferProxyId, newText, startPos);
    } else if (msg.type === TEXT_BUFFER_PROXY_DELETE) {
      const {textBufferProxyId, startPos, endPos} = msg;
      this.localDeleteAndBroadcast(textBufferProxyId, startPos, endPos);
    } else {
      logError(`Unknown message type "${msg.type}" from observable`);
    }
  }

  /**
   * Fire up the peer connection layer
   */
  fireUp() {
    // Create lower-level RTCPeerConnection handler
    // TODO: PeerConnectionLayer should actually take in a configuration
    // dictionary specified by the controller (and this config should include
    // the signaling server URL)
    return new Promise(async (resolve, reject) => {
      try {
        log(`Creating PeerConnectionLayer for Controller "${this.siteId}"...`);
        this.peerConnectionLayer = new PeerConnectionLayer(this);
        log(`Firing up PeerConnectionLayer...`);
        await this.peerConnectionLayer.fireUp();
        log('Successfully fired up PeerConnectionLayer');
        resolve(this);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Handle local insertion of characters into CRDT and then broadcast
   * character-insertion messages to remote peers.
   */
  async localInsertAndBroadcast(textBufferProxyId, characters, startPos) {
    let [_, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

    for (let i = 0; i < characters.length; i++) {
      if (characters[i - 1] === '\n') {
        currentPos.lineIndex++;
        currentPos.charIndex = 0;
      }
      const charObj = await crdt.handleLocalInsert(characters[i], currentPos);

      // Broadcast message to all peers
      const msg = {
        type: MessageTypes.INSERT,
        textBufferProxyId: textBufferProxyId,
        charObject: charObj,
      };
      this.peerConnectionLayer.broadcastMessage(JSON.stringify(msg));
    }
  }

  /**
   * Handle local deletion of characters over the range [startPos, endPos) and
   * then broadcast character-deletion messages to remote peers.
   */
  async localDeleteAndBroadcast(textBufferProxyId, startPos, endPos) {
    let [_, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

    const deletedCharObjs = await crdt.handleLocalDelete(startPos, endPos);

    // TODO: Investigate opportunities for batch-delete (i.e. deletion of
    // multi-char strings instead of single characters)
    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const msg = {
        type: MessageTypes.DELETE,
        textBufferProxyId: textBufferProxyId,
        charObject: charObj,
      }
      this.peerConnectionLayer.broadcastMessage(JSON.stringify(msg));
    }
  }

  /**
   * Handle insertion of character object (presumably received from remote peer)
   * into text buffer (via text buffer proxy).
   */
  async remoteInsert(textBufferProxyId, charObj) {
    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

    // Note that inserted "charObj" is (or at least, should be) the same as
    // returned "charObj"
    // TODO: String-wise insertion in v2
    let [_, insertPos] = await crdt.handleRemoteInsert(charObj);

    //if (retCharObj.compareTo(charObj) !== 0) {
      //const errMessage = `Expected character object: `;
      //errMessage += `${JSON.stringify(charObj)}. Received: `;
      //errMessage += `${JSON.stringify(retCharObj)}`;
      //logError(errMessage);
      //return;
    //}

    const insertionPoint = _convertPositionToPoint(insertPos);
    const charValue = charObj.getValue();
    textBufferProxy.insertIntoTextBuffer(insertionPoint, charValue);
  }

  /**
   * Handle deletion of a character object (presumably received from remote
   * peer).
   */
  async remoteDelete(textBufferProxyId, charObj) {
    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);
    // TODO: We need to add version vectors to CRDT to handle causality (e.g. when receiving a deletion message before the appropriate insert message has been received).
    // TODO: Multi-char Obj deletion in v2
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

  /**
   * Return the TextBufferProxy and CRDT referenced by the given ID
   */
  _getTextBufferProxyAndCRDT(textBufferProxyId) {
    let crdt = this.crdts.get(textBufferProxyId);
    let textBufferProxy = this.textBufferProxies.get(textBufferProxyId);

    if (!crdt) {
      let errMessage;

      if (!textBufferProxy) {
        errMessage = 'Trying to insert into CRDT of a non-existent ';
        errMessage += 'TextBufferProxy: ' + textBufferProxyId);
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

  /**
   * Handle a message delivered by the PeerConnectionLayer
   */
  async handleDeliveredMessage(msgString) {
    // Message assumed to be in JSON format
    const message = JSON.parse(msgString);
    const stringifiedCharObj = message.charObject;
    // Need to create a new `Char` object
    const idArray = stringifiedCharObj.idArray.map(id => {
      return new Identifier(id.value, id.siteId);
    });
    let charObj = new Char(rawCharObj.value, idArray);

    if (message.type === MessageTypes.INSERT) {
      this.remoteInsert(msg.textBufferProxyId, charObj);
    } else if (message.type === MessageTypes.DELETE) {
      this.remoteDelete(msg.textBufferProxyId, charObj);
    } else {
      let errMessage = `Unrecognized operation type "${message.type}" from `;
      errMessage += `delivered message: ${msgString}`;
      logError(errMessage);
    }
  }
}

module.exports = Controller;
