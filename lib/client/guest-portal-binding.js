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
  populateCRDT,
  deserializeCharObject,
} = require('./portal-helpers.js');
const path = require('path');

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

// Maximum number of messages in a batch
const _MESSAGE_BATCH_LIMIT = 32;

// Logging setup
log.setLevel(config.logLevels.guestPortalBinding);

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
    this.textEditorsById = new Map();  // TextEditors by buffer-proxy ID
    this.bufferProxyIdMap = new Map(); // Map from host buffer proxy ID to
                                       // guest buffer proxy IDs
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

      // Send message
      if (i === characters.length - 1 ||
          messageBatch.length % _MESSAGE_BATCH_LIMIT === 0)
      {
        const messageBatchCopy = Object.assign([], messageBatch);
        const msgBody = new MessageBuilder().
                        setMessageBatch(messageBatchCopy).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        messageBatch = [];
        this.emitter.emit('enqueue-message', message);
      }
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

      if (i === deletedCharObjs.length - 1 ||
          messageBatch.length % _MESSAGE_BATCH_LIMIT === 0)
      {
        // Send message
        const messageBatchCopy = Object.assign([], messageBatch);
        const msgBody = new MessageBuilder().
                        setMessageBatch(messageBatchCopy).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        messageBatch = [];
        this.emitter.emit('enqueue-message', newMsg);
      }
    }
  }

  /**
   * Handle a message received from a remote peer
   */
  async handleRemoteMessage(message) {
    const logObj = {message: message};
    log.debug('Handling remote message: ', logObj);

    const {header, body} = message;
    switch (header.type) {

      case INSERT: {
        const {textBufferProxyId, charObject} = body;

        // Do further deserialization
        const deserializedCharObj = deserializeCharObject(charObject);
        await this._remoteInsert(textBufferProxyId, deserializedCharObj);
        break;
      }

      case DELETE: {
        const {textBufferProxyId, charObject} = body;

        // Do further deserialization
        const deserializedCharObj = deserializeCharObject(charObject);
        await this._remoteDelete(textBufferProxyId, deserializedCharObj);
        break;
      }

      case INSERT_BATCH: {
        for (let i = 0; i < body.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = body.messageBatch[i];

          // Do further deserialization
          const deserializedCharObj = deserializeCharObject(charObject);
          await this._remoteInsert(textBufferProxyId, deserializedCharObj);
        }
        break;
      }

      case DELETE_BATCH: {
        for (let i = 0; i < body.messageBatch.length; i++) {
          const {textBufferProxyId, charObject} = body.messageBatch[i];

          // Do further deserialization
          const deserializedCharObj = deserializeCharObject(charObject);
          await this._remoteDelete(textBufferProxyId, deserializedCharObj);
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
   * Insert the given character object into the CRDT for the buffer-proxy, and
   * also insert the character object's value into the text-buffer-proxy.
   */
  async _remoteInsert(hostBufferProxyId, charObj) {
    const logObj = {
      hostBufferProxyId: hostBufferProxyId,
      charObj: charObj,
      value: charObj.getValue(),
    };
    log.debug('Doing remote insert: ', logObj);

    // Get text-buffer-proxy and CRDT
    let bufferProxy;
    let crdt;
    const guestBufferProxyId = this.bufferProxyIdMap.get(hostBufferProxyId);

    if (!guestBufferProxyId) {
      [bufferProxy, crdt] =
        await this._createBufferProxyAndCRDT(hostBufferProxyId);
    } else {
      [bufferProxy, crdt] =
        await this._getTextBufferProxyAndCRDT(guestBufferProxyId);
    }

    // Insert into CRDT and compute positions
    let [_, insertPos] = await crdt.handleRemoteInsert(charObj);
    const insertionPoint = convertPositionToPoint(insertPos);
    const charValue = charObj.getValue();

    log.debug('CRDT line array: ', {lineArray: crdt.getLineArray()});

    // Insert into text-buffer-proxy
    await bufferProxy.insertIntoTextBuffer(insertionPoint, charValue);
  }

  /**
   * Delete the given character object into the CRDT for the buffer-proxy, and
   * also delete the character object's value into the text-buffer-proxy.
   */
  async _remoteDelete(hostBufferProxyId, charObj) {
    const logObj = {
      hostBufferProxyId: hostBufferProxyId,
      charObj: charObj,
      value: charObj.getValue(),
    };
    log.debug('Doing remote delete: ', logObj);

    // Get text-buffer-proxy and CRDT
    let bufferProxy;
    let crdt;
    const guestBufferProxyId = this.bufferProxyIdMap.get(hostBufferProxyId);

    if (!guestBufferProxyId) {
      [bufferProxy, crdt] =
        await this._createBufferProxyAndCRDT(hostBufferProxyId);
    } else {
      [bufferProxy, crdt] =
        await this._getTextBufferProxyAndCRDT(guestBufferProxyId);
    }

    // Delete from CRDT and compute positions
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

    log.debug('CRDT line array: ', {lineArray: crdt.getLineArray()});

    // Delete from text-buffer-proxy
    await bufferProxy.deleteFromTextBuffer(deletionRange);
  }

  /****************************** MISCELLANOUS ********************************/

  /**
   * Create a TextBufferProxy and CRDT and then map the given
   * `hostBufferProxyId` to a local `guestBufferProxyId` and store this ID in
   * this class' state.
   */
  _createBufferProxyAndCRDT(hostBufferProxyId) {
    return new Promise(async (resolve) => {
      let logObj = {hostBufferProxyId: hostBufferProxyId};
      log.debug('Creating TextBufferProxy and CRDT: ', logObj);

      // Create TextBufferProxy ID
      const guestBufferProxyId =
        await this._createGuestBufferProxyId(hostBufferProxyId);

      // Store entry in hashmap
      this.bufferProxyIdMap.set(hostBufferProxyId, guestBufferProxyId);
      resolve(guestBufferProxyId);

    }).then(async guestBufferProxyId => {

      // Create new TextEditor
      await log.info('Opening text editor.');
      const textEditor = await this.workspace.open();

      // Store text editor in map
      this.textEditorsById.set(guestBufferProxyId, textEditor);

      // Get TextBuffer
      const textBuffer = textEditor.getBuffer();
      return [guestBufferProxyId, textBuffer];

    }).then(async ([guestBufferProxyId, textBuffer]) => {

      // Create TextBufferProxy
      const bufferProxy = new TextBufferProxy(textBuffer, guestBufferProxyId);
      log.debug('Created buffer proxy: ', {bufferProxy: bufferProxy});

      // Store reference in map
      this.bufferProxiesById.set(guestBufferProxyId, bufferProxy);

      // Set the TextBuffer to be backed by the given path
      await textBuffer.setPath(guestBufferProxyId);
      log.debug('Set text buffer path: ', {path: guestBufferProxyId});

      await bufferProxy.activateListeners();
      return bufferProxy;

    }).then(async bufferProxy => {

      // Create CRDT
      const crdt = await populateCRDT(bufferProxy, this.siteId);

      // Store reference in map
      this.crdtsById.set(bufferProxy.getId(), crdt);
      return [bufferProxy, crdt];

    }).catch(error => {

      log.error(error);

    });
  }

  _createGuestBufferProxyId(hostBufferProxyId) {
    const root = path.resolve();
    const basename = path.basename(hostBufferProxyId);
    const guestBufferProxyId =
      path.join(root, this.portalHostUsername, basename);
    return guestBufferProxyId;
  }

  async _getTextBufferProxyAndCRDT(guestBufferProxyId) {
    let logObj = {guestBufferProxyId: guestBufferProxyId};
    log.debug('Retrieving TextBufferProxy and CRDT: ', logObj);

    const targetEditor = await this.textEditorsById.get(guestBufferProxyId);

    if (!targetEditor) {
      logObj = {guestBufferProxyId: guestBufferProxyId};
      log.error('Editor for buffer proxy is undefined: ', logObj);
      return;
    }

    const targetEditorUri = await targetEditor.getBuffer().getUri();
    const pane = await this.workspace.paneForURI(targetEditorUri);
    if (!pane) {
      log.debug('Mounting pane for URI: ', {uri: targetEditorUri});
      await this.workspace.open(targetEditorUri);
    }
    let crdt = await this.crdtsById.get(guestBufferProxyId);
    let bufferProxy = await this.bufferProxiesById.get(guestBufferProxyId);
    log.debug('Returned buffer proxy: ', {bufferProxy: bufferProxy});
    return [bufferProxy, crdt];
  }
}
module.exports = GuestPortalBinding;
