'use babel';

const uuid = require('uuid/v1');
const PeerConnectionLayer = require('./peer-connection-layer.js');
const MessageTypes = require('./message-types.js');

// CRDT
const PapyrusCRDT = require('papyrus-crdt');
const CRDT = PapyrusCRDT.CRDT;
const Identifier = PapyrusCRDT.Identifier;
const Char = PapyrusCRDT.Char;

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

class Controller {
  constructor() {
    // Unique siteId for peer (private and used for CRDT)
    this.siteId = uuid();
    // Unique local peer ID assigned by signaling server (this is the ID that
    // will be shared with remote peers when they wish to connect the portal
    // hosted by "this" peer)
    this.localPeerId;
    // Peer connection layer used to handle network connections
    this.peerConnectionLayer;
    // Two hashmaps of text buffer proxies and associated CRDT data structure,
    // both keyed by the ID of the textBufferProxy
    this.textBufferProxies = new Map();
    this.crdts = new Map();
  }

  /**
   * Fire up the peer connection layer
   */
  fireUp() {
    return new Promise(async (resolve, reject) => {
      try {
        resolve(this);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Tear down controller
   */
  tearDown() {
    log('Tearing down controller...');
    log('Detaching text buffer proxies and CRDTs for text buffer proxy IDs:');
    this.textBufferProxies.forEach((textBufferProxy, id) => {
      console.log(id);
    });
    this.crdts = null;
    this.textBufferProxies = null;
  }

  /**
   * Attach a PeerConnectionLayer to this Controller, which the Controller will
   * use to broadcast messages
   */
  addPeerConnectionLayer(peerConnectionLayer) {
    this.peerConnectionLayer = peerConnectionLayer;
  }

  connectToPortal(portalHostPeerId) {
    if (!peerConnectionLayer) {
      let errMessage = 'Cannot connect to portal as PeerConnectionLayer ';
      errMessage += 'is undefined.';
      logError(errMessage);
    }
    log('Connecting to portal host with peer ID: ' + portalHostPeerId);
    this.peerConnectionLayer.connectToPeer(portalHostPeerId);
  }

  /**
   * Add a TextBufferProxy class to the Controller, so that the Controller can
   * update it based on remote events.
   */
  async addTextBufferProxy(textBufferProxy) {
    let id = textBufferProxy.getId();
    log('ID: ' + this.siteId);
    this.textBufferProxies.set(id, textBufferProxy);
    log('Creating and populating CRDT using content from text buffer ' +
        'proxy: ' + id);
    // Populate CRDT and once that's done, insert it into the hashmap of CRDTs.
    let crdt = await this._populateCRDT(textBufferProxy);
    log('Populated CRDT for text buffer proxy: ' + id);
    this.crdts.set(id, crdt);
  }

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

  /**
   * Controller implements "observer" interface; this function should be called
   * by any "observable" to which the Controller has subscribed.
   */
  notify(msg) {
    log('Notified of message of type: ' + msg.type);

    if (msg.type === TEXT_BUFFER_PROXY_INSERT) {

      const {textBufferProxyId, newText, startPos} = msg;
      this.localInsertAndBroadcast(textBufferProxyId, newText, startPos);

    } else if (msg.type === TEXT_BUFFER_PROXY_DELETE) {

      const {textBufferProxyId, startPos, endPos} = msg;
      this.localDeleteAndBroadcast(textBufferProxyId, startPos, endPos);

    } else if (msg.type === DATA_CHANNEL_MESSAGE) {

      const {data} = msg;
      this.handleDeliveredMessage(data);

    } else if (msg.type === LOCAL_PEER_ID) {

      const {localPeerId} = msg;
      this.localPeerId = localPeerId;
      atom.notifications.addSuccess('Local Peer ID: ' + localPeerId);

    } else {
      logError(`Unknown message type "${msg.type}" from observable`);
    }
  }

  /**
   * Handle local insertion of characters into CRDT and then broadcast
   * character-insertion messages to remote peers.
   */
  async localInsertAndBroadcast(textBufferProxyId, characters, startPos) {
    let [_, crdt] =
      this._getTextBufferProxyAndCRDT(textBufferProxyId);

    let currentPos = Object.assign({}, startPos);

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
    // TODO: if 'textBufferProxyId' does not exist, we need to create a new text
    // buffer proxy with an ID based on 'textBufferProxyId' and then wrap this
    // text buffer proxy in what we'll call the "active remote text editor"
    // (i.e. the text editor that remote peers use to follow the buffer of the
    // host peer)
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

    let textBufferProxyId = this._constructTextBufferProxyId(message);

    if (message.type === MessageTypes.INSERT) {
      this.remoteInsert(textBufferProxyId, charObj);
    } else if (message.type === MessageTypes.DELETE) {
      this.remoteDelete(textBufferProxyId, charObj);
    } else {
      let errMessage = `Unrecognized operation type "${message.type}" from `;
      errMessage += `delivered message: ${msgString}`;
      logError(errMessage);
    }
  }

  /**
   * Construct the ID of the text buffer proxy. Result depends on whether the
   * message on the given portal is coming from the portal host.
   */
  _constructTextBufferProxyId(message) {
    let textBufferProxyId;
    if (message.portalHostPeerId === message.senderPeerId) {
    // Message on this portal is coming from the portal host
      textBufferProxyId = message.portalHostPeerId;
      textBufferProxyId += '/' + message.textBufferProxyId;
    } else {
      textBufferProxyId = message.textBufferProxyId;
    }
    return textBufferProxyId;
  }
}

module.exports = Controller;
