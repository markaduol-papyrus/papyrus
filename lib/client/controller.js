'use babel';

const uuid = require('uuid/v1');
const PeerConnectionLayer = require('./peer-connection-layer.js');
const MessageTypes = require('./message-types.js');

// CRDT
const PapyrusCRDT = require('papyrus-crdt');
const CRDT = PapyrusCRDT.CRDT;
const Identifier = PapyrusCRDT.Identifier;
const Char = PapyrusCRDT.Char;

///////////////////////////// ERRORS AND LOGGING ///////////////////////////////
function logError(message) {
  console.error('CONTROLLER: ' + message);
}

function log(message) {
  console.log('CONTROLLER: ' + message);
}

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
  constructor(textBufferProxy) {
    // Unique siteId for peer
    this.siteId = uuid();
    // Bind to text buffer proxy
    this.textBufferProxy = textBufferProxy;
    // Create CRDT to be used by controller
    this.crdt = new CRDT(this.siteId);
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
  async localInsertAndBroadcast(characters, startPos) {
    let currentPos = Object.assign({}, startPos);

    for (let i = 0; i < characters.length; i++) {
      if (characters[i - 1] === '\n') {
        currentPos.lineIndex++;
        currentPos.charIndex = 0;
      }
      const charObj =
        await this.crdt.handleLocalInsert(characters[i], currentPos);

      // Broadcast message to all peers
      const msg = {
        type: MessageTypes.INSERT,
        charObject: charObj,
      };
      this.peerConnectionLayer.broadcastMessage(JSON.stringify(msg));
    }
  }

  /**
   * Handle local deletion of characters over the range [startPos, endPos) and
   * then broadcast character-deletion messages to remote peers.
   */
  async localDeleteAndBroadcast(startPos, endPos) {
    const deletedCharObjs = await this.crdt.handleLocalDelete(startPos, endPos);
    // TODO: Investigate opportunities for batch-delete (i.e. deletion of
    // multi-char strings instead of single characters)
    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const msg = {
        type: MessageTypes.DELETE,
        charObject: charObj,
      }
      this.peerConnectionLayer.broadcastMessage(JSON.stringify(msg));
    }
  }

  /**
   * Handle insertion of character object (presumably received from remote peer)
   * into text buffer (via text buffer proxy).
   */
  async remoteInsert(charObj) {
    // Note that inserted "charObj" is (or at least, should be) the same as
    // returned "charObj"
    // TODO: String-wise insertion in v2
    let [_, insertPos] = await this.crdt.handleRemoteInsert(charObj);

    //if (retCharObj.compareTo(charObj) !== 0) {
      //const errMessage = `Expected character object: `;
      //errMessage += `${JSON.stringify(charObj)}. Received: `;
      //errMessage += `${JSON.stringify(retCharObj)}`;
      //logError(errMessage);
      //return;
    //}

    const insertionPoint = _convertPositionToPoint(insertPos);
    const charValue = charObj.getValue();
    this.textBufferProxy.insertIntoTextBuffer(insertionPoint, charValue);
  }

  /**
   * Handle deletion of a character object (presumably received from remote
   * peer).
   */
  async remoteDelete(charObj) {
    // TODO: We need to add version vectors to CRDT to handle causality (e.g. when receiving a deletion message before the appropriate insert message has been received).
    // TODO: Multi-char Obj deletion in v2
    const startPos = await this.crdt.handleRemoteDelete(charObj);
    let line = startPos.lineIndex;
    let endPos;

    if (line < this.crdt.length &&
        startPos.charIndex < this.crdt.lineArray[line].length) {
      endPos = {lineIndex: line, charIndex: startPos.charIndex + 1};
    } else {
      endPos = {lineIndex: line + 1, charIndex: 0};
    }

    const deletionRange = _convertPositionsToRange(startPos, endPos);
    this.textBufferProxy.deleteFromTextBuffer(deletionRange);
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
      this.remoteInsert(charObj);
    } else if (message.type === MessageTypes.DELETE) {
      this.remoteDelete(charObj);
    } else {
      let errMessage = `Unrecognized operation type "${message.type}" from `;
      errMessage += `delivered message: ${msgString}`;
      logError(errMessage);
    }
  }
}

module.exports = Controller;
