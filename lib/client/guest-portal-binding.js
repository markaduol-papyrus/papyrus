'use babel';

const { CompositeDisposable, Emitter, TextBuffer } = require('atom');
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
  deserializeCharObject,
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
const JOIN_REQUEST_ACCEPTED = MessageTypes.JOIN_REQUEST_ACCEPTED;

// Logging setup
log.setLevel(config.logLevels.models);

class GuestPortalBinding {

  /**
   * Expected parameters
   * @param {Object} workspace Atom workspace
   * @param {Object} notificationManager Atom notification manager
   * @param {string} username Username of the local peer
   * @param {string} localPeerId local peer ID
   * @param {string} portalHostPeerId The peer ID of the remote portal host
   */
  constructor(props) {
    log.debug('Constructing GuestPortalBinding: ', props);

    this.workspace = props.workspace;
    this.notificationManager = props.notificationManager;
    this.localUsername = props.username;
    this.localPeerId = props.localPeerId;
    this.portalHostPeerId = props.portalHostPeerId;
    this.emitter = new Emitter();
    this.bufferProxiesById = new Map();
    this.crdtsById = new Map();
    this.bufferURIs = new Set();
    this.subscriptions = new CompositeDisposable();
    this.portalHostUsername;
    this.siteId;
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
    this.emitter.emit('enqueue-message', message);
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
    this.emitter.emit('enqueue-message', message);
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

  getLocalUsername() {
    return this.localUsername;
  }

  getPortalHostUsername() {
    return this.portalHostUsername;
  }

  getLocalPeerId() {
    return this.localPeerId;
  }

  getPortalHostPeerId() {
    return this.portalHostPeerId;
  }

  /**
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(message) {
    const logObj = {message: message};
    log.debug('Handling local message: ', logObj);

    switch (message.type) {
      case TEXT_BUFFER_PROXY_INSERT: {
        const {textBufferProxyId, newText, startPos} = message;
        this._localInsertAndEmitEvents(textBufferProxyId, newText, startPos);
        break;
      }
      case TEXT_BUFFER_PROXY_DELETE: {
        const {textBufferProxyId, startPos, endPos} = message;
        this._localDeleteAndEmitEvents(textBufferProxyId, startPos, endPos);
        break;
      }
      default: {
        log.error('Unknown message type: ', message.type);
        break;
      }
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
    let messageBatch = [];
    const msgHeader = new MessageBuilder().
                      setType(INSERT_BATCH).
                      setSenderPeerId(this.localPeerId).
                      setPortalHostPeerId(this.portalHostPeerId).
                      setTargetPeerId(this.portalHostPeerId).
                      getResult();

    for (let i = 0; i < characters.length; i++) {
      if (characters[i - 1] === '\n') {
        currentPos.lineIndex++;
        currentPos.charIndex = 0;
      }
      const charObj = await crdt.handleLocalInsert(characters[i], currentPos);

      const subMessage = new MessageBuilder().
                         setCharObject(charObj).
                         setTextBufferProxyId(bufferProxyId).
                         getResult();
      messageBatch.push(subMessage);
      this.emitter.emit('did-local-insert', subMessage);
    }
    const msgBody = new MessageBuilder().
                    setMessageBatch(messageBatch).
                    getResult();
    const message = new MessageBuilder().
                    setHeader(msgHeader).
                    setBody(msgBody).
                    getResult();
    this.emitter.emit('enqueue-message', message);
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
    let messageBatch = [];
    const msgHeader = new MessageBuilder().
                      setType(DELETE_BATCH).
                      setSenderPeerId(this.localPeerId).
                      setPortalHostPeerId(this.portalHostPeerId).
                      setTargetPeerId(this.portalHostPeerId).
                      getResult();

    for (let i = 0; i < deletedCharObjs.length; i++) {
      const charObj = deletedCharObjs[i];
      const subMessage = new MessageBuilder().
                         setCharObject(charObj).
                         setTextBufferProxyId(bufferProxyId).
                         getResult();
      messageBatch.push(subMessage);
      this.emitter.emit('did-local-delete', subMessage);
    }
    const msgBody = new MessageBuilder().
                    setMessageBatch(messageBatch).
                    getResult();
    const message = new MessageBuilder().
                    setHeader(msgHeader).
                    setBody(msgBody).
                    getResult();
    this.emitter.emit('enqueue-message', message);
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

        // Do further deserialization
        const deserializedCharObj = deserializeCharObject(charObject);
        this._remoteInsert(textBufferProxyId, deserializedCharObj);
        break;
      }

      case DELETE: {
        const {textBufferProxyId, charObject} = body;

        // Do further deserialization
        const deserializedCharObj = deserializeCharObject(charObject);
        this._remoteDelete(textBufferProxyId, deserializedCharObj);
        break;
      }

      case INSERT_BATCH: {
        for (let i = 0; i < body.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = body.messageBatch[i];

          // Do further deserialization
          const deserializedCharObj = deserializeCharObject(charObject);
          this._remoteInsert(textBufferProxyId, deserializedCharObj);
        }
        break;
      }

      case DELETE_BATCH: {
        for (let i = 0; i < body.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = body.messageBatch[i];

          // Do further deserialization
          const deserializedCharObj = deserializeCharObject(charObject);
          this._remoteDelete(textBufferProxyId, deserializedCharObj);
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
                        setUsername(this.localUsername).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        this.emitter.emit('enqueue-message', newMsg);
        break;
      }

      case JOIN_REQUEST_ACCEPTED: {
        this.portalHostUsername = body.username;
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

    // Need to wait for all promises to resolve before destructuring can happen
    // successfully
    let [textBufferProxy, crdt] =
      await this._getOrCreateTextBufferProxyAndCRDT(bufferProxyId);

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

    // Need to wait for all promises to resolve before destructuring can happen
    // successfully
    let [textBufferProxy, crdt] =
      await this._getOrCreateTextBufferProxyAndCRDT(textBufferProxyId);

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
      let bufferProxy = new TextBufferProxy(buffer);
      const crdt = await populateCRDT(bufferProxy, this.siteId);

      // Add event listeners
      bufferProxy.onDidEmitMessage(message => {
        this._handleLocalMessage(message)
      });

      // Store references
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
