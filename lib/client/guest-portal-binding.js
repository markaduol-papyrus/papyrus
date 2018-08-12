'use babel';

const {
  CompositeDisposable, Emitter, Point, Range, TextBuffer
} = require('atom');
const TextBufferProxy = require('./text-buffer-proxy.js');
const MessageTypes = require('./message-types.js');
const MessageBuilder = require('./message-builder.js');

// CRDT
const PapyrusCRDT = require('papyrus-crdt');
const CRDT = PapyrusCRDT.CRDT;
const Identifier = PapyrusCRDT.Identifier;
const Char = PapyrusCRDT.Char;

// Message Types
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;
const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;
const INSERT = MessageTypes.INSERT;
const DELETE = MessageTypes.DELETE;
const INSERT_BATCH = MessageTypes.INSERT_BATCH;
const DELETE_BATCH = MessageTypes.DELETE_BATCH;
const SITE_ID_ASSIGNMENT = MessageTypes.SITE_ID_ASSIGNMENT;
const SITE_ID_ACKNOWLEDGEMENT = MessageTypes.SITE_ID_ACKNOWLEDGEMENT;
const JOIN_PORTAL_REQUEST = MessageTypes.JOIN_PORTAL_REQUEST;
const LEAVE_PORTAL_REQUEST = MessageTypes.LEAVE_PORTAL_REQUEST;
const JOIN_REQUEST_ACCEPTED = MessageTypes.JOIN_REQUEST_ACCEPTED;

// Logging
const config = require('./../config.js')
const log = require('loglevel').getLogger('guest-portal-binding');

///////////////////////////// ERRORS AND LOGGING ///////////////////////////////
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
  const logObj = {startPos: startPos, endPos: endPos};
  log.debug('Converting Position to Range: ', logObj);

  const startPoint = [startPos.lineIndex, startPos.charIndex];
  const endPoint = [endPos.lineIndex, endPos.charIndex];
  return new Range(startPoint, endPoint);
}

/**
 * Convert the given position to an atom `Point` object
 */
function _convertPositionToPoint(position) {
  const logObj = {position: position};
  log.debug('Converting Position to Point: ', logObj);

  return new Point(position.lineIndex, position.charIndex);
}

/**
 * Strip the username, if it exists, from the buffer proxy ID.
 */
function _getPortalHostUsernameFromBufferProxyId(bufferProxyId) {
  const logObj = {bufferProxyId: bufferProxyId};
  log.debug('Getting portal host username from buffer proxy ID: ', logObj);

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
  /** Expected parameters
   * @param {Object} workspace
   * @param {Object} notificationManager
   * @param {Object} portalHostPeerId Peer ID of the portal host to which this
   * peer should connect
   * @param {Object} localPeerId Peer ID of the local (i.e "this") peer
   */
  constructor(props) {
    log.debug('Constructing GuestPortalBinding: ', props);

    const {
      workspace, notificationManager, portalHostPeerId, localPeerId
    } = props;
    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.portalHostPeerId = portalHostPeerId;
    this.localPeerId = localPeerId;
    this.emitter = new Emitter();
    this.bufferProxiesById = new Map();
    this.crdtsById = new Map();
    this.bufferURIs = new Set();
    this.subscriptions = new CompositeDisposable();
    this.siteId;
  }

  /**
   * Populate the CRDT structure of the given text buffer proxy.
   */
  _populateCRDT(bufferProxy) {
    const logObj = {bufferProxy: bufferProxy};
    log.debug('Populating CRDT: ', logObj);

    return new Promise((resolve) => {
      if (!this.siteId) {
        log.warn('Site ID undefined: ', {siteId: this.siteId});
      }
      let crdt = new CRDT(this.siteId);
      let lines = bufferProxy.getBuffer().getLines();
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

  /*********************** INITIALISATION AND LISTENERS ***********************/

  /**
   * Listen to the specified text buffer proxy
   */
  _listenToBufferProxy(bufferProxy) {
    const logObj = {bufferProxy: bufferProxy};
    log.debug('Listening to buffer proxy: ', logObj);

    const id = bufferProxy.getId();
    bufferProxy.onDidEmitMessage(msg => {
      this._handleLocalMessage(msg)
    });
    this.bufferProxiesById.set(id, bufferProxy);
  }

  /******************************* PUBLIC API *********************************/

  /**
   * Initialise the guest portal
   */
  initialise() {
    log.debug('Initialising guest portal binding.');

    // Emit "join portal" request
    const msg = new MessageBuilder().
                setType(JOIN_PORTAL_REQUEST).
                setPortalHostPeerId(this.portalHostPeerId).
                setSenderPeerId(this.localPeerId).
                getResult();
    this.emitter.emit('join-portal-request', msg);
  }


  close() {
    log.debug('Closing guest portal binding.');
    const msg = new MessageBuilder().
                setType(LEAVE_PORTAL_REQUEST).
                setPortalHostPeerId(this.portalHostPeerId).
                setSenderPeerId(this.localPeerId).
                getResult();
    this.emitter.emit('leave-portal-request', msg);
  }

  onJoinPortalRequest(callback) {
    return this.emitter.on('join-portal-request', callback);
  }

  onHostAcceptedJoinPortalRequest(callback) {
    return this.emitter.on('host-accepted-join-portal-request', callback);
  }

  onLeavePortalRequest(callback) {
    return this.emitter.on('leave-portal-request', callback);
  }

  onHostAcceptedLeavePortalRequest(callback) {
    return this.emitter.on('host-accepted-leave-portal-request', callback);
  }

  onDidLocalInsert(callback) {
    return this.emitter.on('did-local-insert', callback);
  }

  onDidLocalDelete(callback) {
    return this.emitter.on('did-local-delete', callback);
  }

  onAcceptedSiteId(callback) {
    return this.emitter.on('accepted-site-id', callback);
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(msg) {
    const logObj = {message: msg};
    log.debug('Handling local message: ', logObj);

    switch (msg.type) {
      case TEXT_BUFFER_PROXY_INSERT: {
        const {textBufferProxyId, newText, startPos} = msg;
        this._localInsertAndEmitEvent(textBufferProxyId, newText, startPos);
        break;
      }

      case TEXT_BUFFER_PROXY_DELETE: {
        const {textBufferProxyId, startPos, endPos} = msg;
        this._localDeleteAndEmitEvent(textBufferProxyId, startPos, endPos);
        break;
      }

      default: {
        log.error('Unknown message type: ', msg.type);
        break;
      }
    }
  }

  /**
   * Insert the given characters into the CRDT for the given text-buffer-proxy
   * ID and emit an event.
   */
  async _localInsertAndEmitEvent(bufferProxyId, characters, startPos) {
    const logObj = {
      bufferProxyId: bufferProxyId,
      characters: characters,
      startPos: startPos
    };
    log.debug('Doing local insert and then event emission: ', logObj);

    let [_, crdt] = this._getTextBufferProxyAndCRDT(bufferProxyId);

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
      const msg = new MessageBuilder().
                  setType(INSERT).
                  setPortalHostPeerId(this.localPeerId).
                  setTextBufferProxyId(bufferProxyId).
                  setCharObject(charObj).
                  getResult();
      this.emitter.emit('did-local-insert', msg);
    }
  }

  /**
   * Get the CRDT for the given text-buffer-proxy ID. Delete from the CRDT the
   * characters in the interval [startPos, endPos), and then emit and event.
   */
  async _localDeleteAndEmitEvent(bufferProxyId, startPos, endPos) {
    const logObj = {
      bufferProxyId: bufferProxyId,
      startPos: startPos,
      endPos: endPos
    };
    log.debug('Doing local delete and then event emission: ', logObj);

    let [_, crdt] = this._getTextBufferProxyAndCRDT(bufferProxyId);

    const deletedCharObjs = await crdt.handleLocalDelete(startPos, endPos);

    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const msg = new MessageBuilder().
                  setType(DELETE).
                  setPortalHostPeerId(this.localPeerId).
                  setTextBufferProxyId(bufferProxyId).
                  setCharObject(charObj).
                  getResult();
      this.emitter.emit('did-local-delete', msg);
    }
  }

  /********************** API FOR PORTAL BINDING MANAGER **********************/
  /**
   * THE FOLLOWING FUNCTIONS SHOULD BE CALLED SPECIFICALLY BY THE PORTAL
   * BINDING MANAGER TO INFORM THE HOST PORTAL BINDING ABOUT THINGS
   */

  /**
   * Handle a message received from a remote peer
   */
  handleRemoteMessage(msg) {
    const logObj = {message: msg};
    log.debug('Handling remote message: ', logObj);

    switch (msg.type) {
      case NOTIFICATION: {
        break;
      }

      case INSERT: {
        const {textBufferProxyId, charObject} = msg;
        this._remoteInsert(textBufferProxyId, charObject);
        break;
      }

      case DELETE: {
        const {textBufferProxyId, charObject} = msg;
        this._remoteDelete(textBufferProxyId, charObject);
        break;
      }

      case INSERT_BATCH: {
        for (let i = 0; i < msg.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = msg.messageBatch[i];
          this._remoteInsert(textBufferProxyId, charObject);
        }
        break;
      }

      case DELETE_BATCH: {
        for (let i = 0; i < msg.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = msg.messageBatch[i];
          this._remoteDelete(textBufferProxyId, charObject);
        }
        break;
      }

      case SITE_ID_ASSIGNMENT: {
        this.siteId = msg.siteId;
        this.notificationManager.addSuccess('Received site ID: ', this.siteId);
        const newMsg = new MessageBuilder().
                       setType(SITE_ID_ACKNOWLEDGEMENT).
                       setSenderPeerId(this.localPeerId).
                       setSiteId(msg.siteId).
                       setUsername(
                         this.portalBindingManager.getLocalUsername()
                       ).
                       setTargetPeerId(msg.senderPeerId).
                       getResult();
        this.emitter.emit('accepted-site-id', newMsg);
        break;
      }

      case JOIN_REQUEST_ACCEPTED: {
        const newMsg = new MessageBuilder().
                       setPortalHostPeerId(msg.senderPeerId).
                       getResult();
        this.emitter.emit('host-accepted-join-portal-request', newMsg);
      }

      default: {
        log.error('Unknown message type: ', msg.type);
        log.debug('Full message: ', msg);
        break;
      }
    }
  }

  /**
   * Get the CRDT specified by the given text-buffer-proxy ID and then insert
   * the specified character object into the CRDT.
   */
  async _remoteInsert(bufferProxyId, charObj) {
    const logObj = {
      bufferProxyId: bufferProxyId,
      charObj: charObj
    };
    log.debug('Doing remote insert: ', logObj);

    let [textBufferProxy, crdt] =
      this._getOrCreateTextBufferProxyAndCRDT(bufferProxyId);

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
    const logObj = {
      bufferProxyId: bufferProxyId,
      charObj: charObj
    };
    log.debug('Doing remote delete: ', logObj);

    let [textBufferProxy, crdt] =
      this._getOrCreateTextBufferProxyAndCRDT(textBufferProxyId);

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
    const logObj = {bufferProxyId: bufferProxyId};
    log.debug('Getting or creating TextBufferProxy and CRDT: ', logObj);

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
}

module.exports = GuestPortalBinding;
