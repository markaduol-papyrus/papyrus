'use babel';

const { CompositeDisposable, Emitter } = require('atom');
const TextBufferProxy = require('./text-buffer-proxy.js');
const MessageTypes = require('./message-types.js');
const MessageBuilder = require('./message-builder.js');
const Errors = require('./errors.js');
const config = require('./../config.js');
const log = require('loglevel').getLogger('guest-portal-binding');
const {
  convertPositionsToRange,
  convertPositionToPoint,
  getPortalHostUsernameFromBufferProxyId,
  populateCRDT,
} = require('./portal-helpers.js');

// Message Types
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;
const INSERT = MessageTypes.INSERT;
const DELETE = MessageTypes.DELETE;
const INSERT_BATCH = MessageTypes.INSERT_BATCH;
const DELETE_BATCH = MessageTypes.DELETE_BATCH;
const SITE_ID_ASSIGNMENT = MessageTypes.SITE_ID_ASSIGNMENT;
const SITE_ID_ACKNOWLEDGEMENT = MessageTypes.SITE_ID_ACKNOWLEDGEMENT;
const JOIN_PORTAL_REQUEST = MessageTypes.JOIN_PORTAL_REQUEST;
const LEAVE_PORTAL_REQUEST = MessageTypes.LEAVE_PORTAL_REQUEST;

// Logging setup
log.setLevel(config.logLevels.models);

class GuestPortalBinding {

  /**
   * Expected parameters
   * @param {Object} workspace Atom workspace
   * @param {Object} notificationManager Atom notification manager
   * @param {string} username Local username
   * @param {string} localPeerId local peer ID
   * @param {string} portalHostPeerId The peer ID of the portal host
   */
  constructor(props) {
    log.debug('Constructing GuestPortalBinding: ', props);

    this.workspace = props.workspace;
    this.notificationManager = props.notificationManager;
    this.username = props.username;
    this.localPeerId = props.localPeerId;
    this.portalHostPeerId = props.portalHostPeerId;
    this.emitter = new Emitter();
    this.bufferProxiesById = new Map();
    this.crdstById = new Map();
    this.bufferURIs = new Set();
    this.subscriptions = new CompositeDisposable();
    this.siteId;
  }

  /******************************* LISTENERS **********************************/

  /**
   * Listen to the specified text buffer proxy
   */
  _listenToBufferProxy(bufferProxy) {
    const logObj = {bufferProxy: bufferProxy};
    log.debug('Listening to buffer proxy: ', logObj);

    const id = bufferProxy.getId();
    bufferProxy.onDidEmitMessage(message => {
      this._handleLocalMessage(message)
    });
    this.bufferProxiesById.set(id, bufferProxy);
  }

  /****************************** PUBLIC API **********************************/

  /**
   * Send a request to a peer to join their portal
   */
  sendJoinPortalRequest() {
    log.debug('Sending request to join portal.');

    // Emit "join portal" request
    const msgHeader = new MessageBuilder().
                      setType(JOIN_PORTAL_REQUEST).
                      setPortalHostPeerId(this.portalHostPeerId).
                      setSenderPeerId(this.localPeerId).
                      setTargetPeerId(this.portalHostPeerId).
                      getResult();
    const message = new MessageBuilder().
                    setHeader(msgHeader).
                    getResult();
    this.emitter.emit('join-portal-request', message);
  }

  /**
   * Send a request to a peer to leave their portal
   */
  sendLeavePortalRequest() {
    log.debug('Sending request to leave portal.');
    const msgHeader = new MessageBuilder().
                      setType(LEAVE_PORTAL_REQUEST).
                      setPortalHostPeerId(this.portalHostPeerId).
                      setTargetPeerId(this.portalHostPeerId).
                      setSenderPeerId(this.localPeerId).
                      getResult();
    const message = new MessageBuilder().
                    setHeader(msgHeader).
                    getResult();
    this.emitter.emit('leave-portal-request', message);
  }

  onDidLocalInsert(callback) {
    return this.emitter.on('did-local-insert', callback);
  }

  onDidLocalDelete(callback) {
    return this.emitter.on('did-local-delete', callback);
  }

  onAddedDisplayMarker(callback) {
    return this.emitter.on('added-display-marker', callback);
  }

  onRemovedDisplayMarker(callback) {
    return this.emitter.on('removed-display-marker', callback);
  }

  onAddedDecoration(callback) {
    return this.emitter.on('added-decoration', callback);
  }

  onRemovedDecoration(callback) {
    return this.emitter.on('removed-decoration', callback);
  }

  onHostAcceptedJoinPortalRequest(callback) {
    return this.emitter.on('host-accepted-join-portal-request', callback);
  }

  onHostRejectedJoinPortalRequest(callback) {
    return this.emitter.on('host-rejected-join-portal-request', callback);
  }

  onEnqueueMessage(callback) {
    return this.emitter.on('enqueue-message', callback);
  }

  /**
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(message) {
    const logObj = {message: message};
    log.debug('Handling local message: ', logObj);

    const {textBufferProxyId, newText, startPos} = message;
    switch (message.type) {
      case TEXT_BUFFER_PROXY_INSERT:
        this._localInsertAndEmitEvents(textBufferProxyId, newText, startPos);
        break;
      case TEXT_BUFFER_PROXY_DELETE:
        this._localDeleteAndEmitEvents(textBufferProxyId, startPos, endPos);
        break;
      default:
        log.error('Unknown message type: ', message.type);
        break;
    }
  }

  /**
   * Insert the given characters into the CRDT for the given text-buffer-proxy
   * ID and emit the relevant events.
   */
  async _localInsertAndEmitEvents(bufferProxyId, characters, startPos) {
    const logObj = {
      bufferProxyId: bufferProxyId,
      characters: characters,
      startPos: startPos,
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

      const msgHeader = new MessageBuilder().
                        setType(INSERT).
                        setSenderPeerId(this.localPeerId).
                        setPortalHostPeerId(this.portalHostPeerId).
                        setTargetPeerId(this.portalHostPeerId).
                        getResult();
      const msgBody = new MessageBuilder().
                      setCharObject(charObj).
                      setTextBufferProxyId(bufferProxyId).
                      getResult();
      const message = new MessageBuilder().
                      setHeader(msgHeader).
                      setBody(msgBody).
                      getResult();
      this.emitter.emit('did-local-insert', message);
      this.emitter.emit('enqueue-message', message);
    }
  }

  /**
   * Get the CRDT for the given text-buffer-proxy ID. Delete from the CRDT the
   * characters in the interval [startPos, endPos), and then emit and event.
   */
  async _localDeleteAndEmitEvents(bufferProxyId, startPos, endPos) {
    const logObj = {
      bufferProxyId: bufferProxyId,
      startPos: startPos,
      endPos: endPos,
    };
    log.debug('Doing local delete and then event emission: ', logObj);

    let [_, crdt] = this._getTextBufferProxyAndCRDT(bufferProxyId);

    const deletedCharObjs = await crdt.handleLocalDelete(startPos, endPos);

    // TODO: Investigate opportunities for batch-delete of characters
    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const msgHeader = new MessageBuilder().
                        setType(DELETE).
                        setSenderPeerId(this.localPeerId).
                        setPortalHostPeerId(this.portalHostPeerId).
                        setTargetPeerId(this.portalHostPeerId).
                        getResult();
      const msgBody = new MessageBuilder().
                      setCharObject(charObj).
                      setTextBufferProxyId(bufferProxyId).
                      getResult();
      const message = new MessageBuilder().
                      setHeader(msgHeader).
                      setBody(msgBody).
                      getResult();
      this.emitter.emit('did-local-delete', message);
      this.emitter.emit('enqueue-message', message);
    }
  }

  /**
   * Handle a message received from a remote peer
   */
  handleRemoteMessage(message) {
    const logObj = {message: message};
    log.debug('Handling remote message: ', logObj);

    const {header, body} = message;
    switch (header.type) {

      case INSERT: {
        const {textBufferProxyId, charObject} = body;
        this._remoteInsert(textBufferProxyId, charObject);
        break;
      }

      case DELETE: {
        const {textBufferProxyId, charObject} = body;
        this._remoteDelete(textBufferProxyId, charObject);
        break;
      }

      case INSERT_BATCH: {
        for (let i = 0; i < body.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = body.messageBatch[i];
          this._remoteInsert(textBufferProxyId, charObject);
        }
        break;
      }

      case DELETE_BATCH: {
        for (let i = 0; i < body.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = body.messageBatch[i];
          this._remoteDelete(textBufferProxyId, charObject);
        }
        break;
      }

      case SITE_ID_ASSIGNMENT: {
        this.siteId = body.siteId;
        this.notificationManager.addSuccess('Received site ID: ' + this.siteId);
        const {senderPeerId, portalHostPeerId} = header;
        const msgHeader = new MessageBuilder().
                          setType(SITE_ID_ACKNOWLEDGEMENT).
                          setSenderPeerId(this.localPeerId).
                          setTargetPeerId(senderPeerId).
                          setPortalHostPeerId(portalHostPeerId).
                          getResult();
        const msgBody = new MessageBuilder().
                        setSiteId(body.siteId).
                        setUsername(this.username).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        this.emitter.emit('accepted-site-id', newMsg);
        break;
      }

      case JOIN_REQUEST_ACCEPTED: {
        const newEvent = {portalHostPeerId: header.portalHostPeerId};
        this.emitter.emit('host-accepted-join-portal-request', newEvent);
        break;
      }

      default: {
        log.error('Unknown message type: ', header.type);
        log.debug('Full message: ', logObj);
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
      charObj: charObj,
    };
    log.debug('Doing remote insert: ', logObj);

    let [textBufferProxy, crdt] =
      this._getOrCreateTextBufferProxyAndCRDT(bufferProxyId);

    let [_, insertPos] = await crdt.handleRemoteInsert(charObj);

    const insertionPoint = convertPositionToPoint(insertPos);
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
      charObj: charObj,
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

    const deletionRange = convertPositionsToRange(startPos, endPos);
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
      const username = getPortalHostUsernameFromBufferProxyId(bufferProxyId);
      // Need to save buffer
      let bufferProxy = new TextBufferProxy(textBuffer);
      const crdt = await populateCRDT(bufferProxy);

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
