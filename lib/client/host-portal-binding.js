'use babel';

const { CompositeDisposable, Emitter } = require('atom');
const TextBufferProxy = require('./text-buffer-proxy.js');
const MessageTypes = require('./message-types.js');
const MessageBuilder = require('./message-builder.js');
const Errors = require('./errors.js');
const config = require('./../config.js');
const log = require('loglevel').getLogger('host-portal-binding');
const {
  convertPositionToPoint,
  convertPositionsToRange,
  populateCRDT,
} = require('./portal-helpers.js');

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
const ACCEPTED_PEER_ID = MessageTypes.ACCEPTED_PEER_ID;
const SERVER = MessageTypes.SERVER;

// Site IDs
const _HOST_SITE_ID = 1;
const _FIRST_GUEST_SITE_ID = 2;

// Maximum number of messages in a batch
const _MESSAGE_BATCH_LIMIT = 32;

// Logging setup
log.setLevel(config.logLevels.hostPortalBinding);

class HostPortalBinding {

  /**
   * Expected parameters
   * @param {Object} workspace Atom workspace
   * @param {Object} notificationManager Atom notification manager
   * @param {string} username Local username
   */
  constructor(props) {
    log.debug('Constructing HostPortalBinding: ', props);

    this.workspace = props.workspace;
    this.notificationManager = props.notificationManager;
    this.username = props.username;
    this.siteId = _HOST_SITE_ID; // Site ID used to initialise the CRDT
    this.nextSiteIdForGuest = _FIRST_GUEST_SITE_ID
    this.bufferProxiesById = new Map();
    this.crdtsById = new Map();
    this.bufferURIs = new Set();
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
    this.guestPeerIds = new Set();
    this.guestPeerMetadataByPeerId = new Map();
    this.usernameBySiteId = new Map();
    this.localPeerId;
  }

  /******************************* LISTENERS **********************************/

  /**
   * Listen to the specified text editor proxy
   */
  _listenToEditorProxy(editorProxy) {
    const logObj = {editorProxy: editorProxy};
    log.debug('Listening to editor proxy: ', logObj);

    const id = editorProxy.getId();
    this.editorProxiesById.set(id, editorProxy);
  }

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

  /**
   * Activate listeners
   */
  activateListeners() {
    log.debug('Activating listeners for HostPortalBinding.');

    this.subscriptions.add(
      this.workspace.observeActiveTextEditor(async editor => {
        if (editor) {
          let textBuffer = editor.getBuffer();
          let uri = textBuffer.getUri();
          if (!this.bufferURIs.has(uri)) {
            this.bufferURIs.add(uri);

            let bufferProxy = new TextBufferProxy(textBuffer);
            let crdt = await populateCRDT(bufferProxy, this.siteId);
            const bufferProxyId = bufferProxy.getId();

            this.crdtsById.set(bufferProxyId, crdt);
            await bufferProxy.activateListeners();
            this.bufferProxiesById.set(bufferProxyId, bufferProxy)
            this._listenToBufferProxy(bufferProxy);
          }
        }
      })
    );
    this.usernameBySiteId.set(this.siteId, this.username);
    this.emitter.emit('activated-listeners');
  }

  /**
   * Deactivate listeners
   */
  deactivateListeners() {
    log.debug('Deactivating listeners for HostPortalBinding.');

    this.subscriptions.dispose();
    this.emitter.emit('deactivated-listeners');
  }

  /** API FOR EVENT SUBSCRIPTIONS **/

  onActivatedListeners(callback) {
    return this.emitter.on('activated-listeners', callback);
  }

  onDeactivatedListeners(callback) {
    return this.emitter.on('deactivated-listeners', callback);
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

  onAcceptedJoinPortalRequest(callback) {
    return this.emitter.on('accepted-join-portal-request', callback);
  }

  onRejectedJoinPortalRequest(callback) {
    return this.emitter.on('rejected-join-portal-request', callback);
  }

  onAcceptedLeavePortalRequest(callback) {
    return this.emitter.on('accepted-leave-portal-request', callback);
  }

  onRejectedLeavePortalRequest(callback) {
    return this.emitter.on('rejected-leave-portal-request', callback);
  }

  onEnqueueMessage(callback) {
    return this.emitter.on('enqueue-message', callback);
  }

  onEnqueueMessageBatch(callback) {
    return this.emitter.on('enqueue-message-batch', callback);
  }

  onDeliveredLocalPeerId(callback) {
    return this.emitter.on('delivered-local-peer-id', callback);
  }

  /**
   * Return the username of the local peer with the given site ID
   */
  getUsernameBySiteId(siteId) {
    log.debug('Retrieving username by site ID: ', {siteId: siteId});

    const username = this.usernameBySiteId.get(siteId);
    if (!username) {
      log.warn('Undefined username for site ID: ', siteId);
    }
    return username;
  }

  /**
   * Get site IDs of all local peers, including the local peer
   */
  getActiveSiteIds() {
    log.debug('Retrieving active site IDs');

    let siteIds = [this.siteId];
    for (let [peerId, metadata] of this.guestPeerMetadataByPeerId.entries()) {
      if (!metadata.siteId) {
        log.error('Unexpected. Site ID for peer: ', peerId, ' not found.');
      } else {
        siteIds.push(metadata.siteId);
      }
    }
    return siteIds;
  }

  hasGuestPeers() {
    return this.guestPeerIds.size > 0;
  }

  getGuestPeerIds() {
    return this.guestPeerIds;
  }

  getLocalPeerId() {
    return this.localPeerId;
  }

  getLocalUsername() {
    return this.username;
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

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
    let subMessages = [];
    const msgHeader = new MessageBuilder().
                      setType(INSERT_BATCH).
                      setSenderPeerId(this.localPeerId).
                      setPortalHostPeerId(this.localPeerId).
                      setTargetPeerIds(this.guestPeerIds).
                      getResult();

    for (let i = 0; i < characters.length; i++) {

      // Do insertion into CRDT
      if (characters[i - 1] === '\n') {
        currentPos.lineIndex++;
        currentPos.charIndex = 0;
      }
      const charObj = await crdt.handleLocalInsert(characters[i], currentPos);
      this.emitter.emit('did-local-insert', {charObject: charObj});

      // Construct message
      const subMessage = new MessageBuilder().
                         setCharObject(charObj).
                         setTextBufferProxyId(bufferProxyId).
                         getResult();
      subMessages.push(subMessage);

      // Send message
      if (subMessages.length % _MESSAGE_BATCH_LIMIT === 0) {
        const subMessagesCopy = Object.assign([], subMessages);
        const msgBody = new MessageBuilder().
                        setMessageBatch(subMessagesCopy).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        subMessages = [];
        this.emitter.emit('enqueue-message', newMsg);
      }
    }

    if (subMessages.length !== 0) {

      // Send final message
      const subMessagesCopy = Object.assign([], subMessages);
      const msgBody = new MessageBuilder().
                      setMessageBatch(subMessagesCopy).
                      getResult();
      const newMsg = new MessageBuilder().
                     setHeader(msgHeader).
                     setBody(msgBody).
                     getResult();
      this.emitter.emit('enqueue-message', newMsg);
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

    // Do deletion
    let [_, crdt] = this._getTextBufferProxyAndCRDT(bufferProxyId);
    const deletedCharObjs = await crdt.handleLocalDelete(startPos, endPos);
    this.emitter.emit(
      'did-local-delete', {deletedCharObjects: deletedCharObjs}
    );

    // Construct message header
    let subMessages = [];
    const msgHeader = new MessageBuilder().
                      setType(DELETE_BATCH).
                      setSenderPeerId(this.localPeerId).
                      setPortalHostPeerId(this.localPeerId).
                      setTargetPeerIds(this.guestPeerIds).
                      getResult();

    // TODO: Investigate opportunities for batch-delete of characters
    for (let i = 0; i < deletedCharObjs.length; i++) {

      // Construct message
      const charObj = deletedCharObjs[i];
      const subMessage = new MessageBuilder().
                         setCharObject(charObj).
                         setTextBufferProxyId(bufferProxyId).
                         getResult();
      subMessages.push(subMessage);

      if (subMessages.length % _MESSAGE_BATCH_LIMIT === 0) {

        // Send message
        const subMessagesCopy = Object.assign([], subMessages);
        const msgBody = new MessageBuilder().
                        setMessageBatch(subMessagesCopy).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        subMessages = [];
        this.emitter.emit('enqueue-message', newMsg);
      }
    }

    if (subMessages.length !== 0) {

      // Send final message
      const subMessagesCopy = Object.assign([], subMessages);
      const msgBody = new MessageBuilder().
                      setMessageBatch(subMessagesCopy).
                      getResult();
      const newMsg = new MessageBuilder().
                     setHeader(msgHeader).
                     setBody(msgBody).
                     getResult();
      this.emitter.emit('enqueue-message', newMsg);
    }
  }

  /**
   * Validate remote-origin message
   */
  _validateRemoteMessage(message) {
    // TODO
  }


  /**
   * Handle a message received from a remote peer or the signalling server
   */
  async handleRemoteMessage(message) {
    const logObj = {message: message};
    log.debug('Handling remote message: ', logObj);

    const {header, body} = message;
    switch (header.type) {

      case LOCAL_PEER_ID: {
        const {localPeerId} = body;
        this.localPeerId = localPeerId;
        this.emitter.emit(
          'delivered-local-peer-id', {localPeerId: this.localPeerId}
        );

        // TODO: Refactor server code to make the code below work
        /*const msgHeader = new MessageBuilder().
                          setType(ACCEPTED_PEER_ID).
                          setSenderPeerId(this.localPeerId).
                          getResult();
        const msgBody = new MessageBuilder().
                        setLocalPeerId(this.localPeerId).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();*/
        const newMsg = new MessageBuilder().
                       setType(ACCEPTED_PEER_ID).
                       setSenderPeerId(this.localPeerId).
                       setFlag(SERVER).
                       getResult();
        this.emitter.emit('enqueue-message', newMsg);
        break;
      }

      case JOIN_PORTAL_REQUEST: {
        const {portalHostPeerId, senderPeerId} = header;
        // TODO: Contextual validation of header
        const msgHeader = new MessageBuilder().
                          setType(SITE_ID_ASSIGNMENT).
                          setSenderPeerId(this.localPeerId).
                          setTargetPeerId(senderPeerId).
                          setPortalHostPeerId(portalHostPeerId).
                          getResult();
        const msgBody = new MessageBuilder().
                        setSiteId(this.nextSiteIdForGuest).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        this.nextSiteIdForGuest += 1;
        this.emitter.emit('enqueue-message', newMsg);
        break;
      }

      case LEAVE_PORTAL_REQUEST: {
        break;
      }

      case INSERT: {
        const {senderPeerId} = header;
        const {textBufferProxyId, charObject} = body;
        const bufferProxyId =
          this._stripUsernameFromBufferProxyId(textBufferProxyId);
        this._remoteInsert(bufferProxyId, charObject);
        this._forwardToGuests(senderPeerId, message);
        break;
      }

      case DELETE: {
        const {senderPeerId} = header;
        const {textBufferProxyId, charObject} = body;
        const bufferProxyId =
          this._stripUsernameFromBufferProxyId(textBufferProxyId);
        this._remoteDelete(bufferProxyId, charObject);
        this._forwardToGuests(senderPeerId, message);
        break;
      }

      case SITE_ID_ACKNOWLEDGEMENT: {
        const {senderPeerId, portalHostPeerId} = header;
        const {siteId, username} = body;
        await this._registerNewGuestPeer(siteId, senderPeerId, username);

        // Tell new guest peer that it's request to join this portal has been
        // accepted. Send local username as well.
        const msgHeader = new MessageBuilder().
                          setType(JOIN_REQUEST_ACCEPTED).
                          setSenderPeerId(this.localPeerId).
                          setTargetPeerId(senderPeerId).
                          setPortalHostPeerId(portalHostPeerId).
                          getResult();
        const msgBody = new MessageBuilder().
                        setUsername(this.username).
                        getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       setBody(msgBody).
                       getResult();
        this.emitter.emit('accepted-join-portal-request', newMsg);
        this.emitter.emit('enqueue-message', newMsg);
        break;
      }

      default: {
        log.error('Unknown message type: ', message.type);
        log.debug('Full message: ', message);
        break;
      }
    }
  }

  _registerNewGuestPeer(guestSiteId, guestPeerId, guestUsername) {
    const logObj = {
      guestSiteId: guestSiteId,
      guestPeerId: guestPeerId,
      guestUsername: guestUsername,
    };
    log.debug('Registering new peer: ', logObj);

    return new Promise((resolve) => {
      this.notificationManager.addSuccess('New guest peer: ' + guestUsername);
      this.guestPeerIds.add(guestPeerId);
      this.guestPeerMetadataByPeerId.set(guestPeerId, {
        siteId: guestSiteId,
        username: guestUsername,
      });
      this.usernameBySiteId.set(guestSiteId, guestUsername);
      resolve();
    });
  }

  /**
   * Get the CRDT specified by the given text-buffer-proxy ID and then insert
   * the specified character object into the CRDT.
   */
  async _remoteInsert(bufferProxyId, charObj) {
    const logObj = {bufferProxyId: bufferProxyId, charObj: charObj};
    log.debug('Doing remote insert: ', logObj);

    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(bufferProxyId);

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
  async _remoteDelete(bufferProxyId, charObj) {
    const logObj = {bufferProxyId: bufferProxyId, charObj: charObj};
    log.debug('Doing remote delete: ', logObj);

    let [textBufferProxy, crdt] =
      this._getTextBufferProxyAndCRDT(bufferProxyId);

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


  /***************************** MISCELLANOUS *********************************/

  /**
   * Forward message to all peers except the sender of the message
   */
  _forwardToGuests(senderPeerId, message) {
    const logObj = {senderPeerId: senderPeerId, message: message};
    log.debug('Forwarding message to guests: ', logObj);

    let msgCopy = Object.assign({}, message);
    let targetPeerIds = new Set(message.header.targetPeerIds);
    targetPeerIds.delete(senderPeerId);
    msgCopy.header.targetPeerIds = targetPeerIds;
    this.emitter.emit('enqueue-message', msgCopy);
  }

  /**
   * Strip the username, if it exists, from the buffer proxy ID.
   */
  _stripPortalHostUsernameFromBufferProxyId(bufferProxyId) {
    const logObj = {bufferProxyId: bufferProxyId};
    log.debug('Stripping portal host username from buffer proxy ID: ', logObj);

    const [username, rawBufferProxyId] = bufferProxyId.split('/');
    return rawBufferProxyId;
  }

  /**
   * Add the username of this peer to the buffer proxy ID
   */
  _addUsernameToTextBufferProxyId(bufferProxyId) {
    const logObj = {bufferProxyId: bufferProxyId};
    log.debug('Adding username to buffer proxy ID: ', logObj);

    return this.username + '/' + bufferProxyId;
  }

  /**
   * For every text-buffer-proxy that this portal host is listening to, we
   * obtain the CRDT for that text-buffer-proxy and send the current state of
   * the CRDT to the specified peer ID.
   */
  _sendCurrentTextBufferStatesToNewPeer(targetPeerId) {
    const logObj = {targetPeerId: targetPeerId};
    log.debug('Sending current text buffer state to peer: ', logObj);

    let subMessages = [];

    // Construct message header for each message batch
    const msgHeader = new MessageBuilder().
                      setType(INSERT_BATCH).
                      setSenderPeerId(this.localPeerId).
                      setPortalHostPeerId(this.localPeerId).
                      setTargetPeerId(targetPeerId).
                      getResult();

    for (let [textBufferProxyId, crdt] of this.crdtsById.entries()) {
      let lineArray = crdt.getLineArray();

      for (let i = 0; i < lineArray.length; i++) {
        for (let j = 0; j < lineArray[i].length; j++) {
          const charObj = lineArray[i][j];

          const subMessage = new MessageBuilder().
                             setTextBufferProxyId(textBufferProxyId).
                             setCharObject(charObj).
                             getResult();
          subMessages.push(subMessage);

          if ((i === lineArray.length - 1 && j === lineArray[i].length - 1) ||
              subMessages.length % _MESSAGE_BATCH_LIMIT === 0)
          {
            const subMessagesCopy = Object.assign([], subMessages);
            const msgBody = new MessageBuilder().
                            setMessageBatch(subMessagesCopy).
                            getResult();
            const newMsg = new MessageBuilder().
                           setHeader(msgHeader).
                           setBody(msgBody).
                           getResult();
            subMessages = [];
            this.emitter.emit('enqueue-message', newMsg);
          }
        }
      }
    }
  }

  /**
   * Return the TextBufferProxy and CRDT referenced by the given ID.
   */
  _getTextBufferProxyAndCRDT(bufferProxyId) {
    const logObj = {bufferProxyId: bufferProxyId};
    log.debug('Retrieving TextBufferProxy and CRDT: ', logObj);

    let crdt = this.crdtsById.get(bufferProxyId);
    let textBufferProxy = this.bufferProxiesById.get(bufferProxyId);

    if (!crdt) {
      let errMessage;

      if (!textBufferProxy) {
        errMessage = 'Trying to insert into CRDT of a non-existent ';
        errMessage += 'TextBufferProxy: ' + bufferProxyId;
        throw new Error(errMessage);
      } else {
        errMessage = 'Expected CRDT for TextBufferProxy ';
        errMessage += `"${textBufferProxyId}" to exist, but it does not.`;
        throw new Errors.NonExistentCRDTException(errMessage);
      }
    }

    if (!textBufferProxy) {
      let errMessage = `Expected TextBufferProxy "${textBufferProxyId}"`;
      errMessage += ' to exist, but it does not.';
      throw new Errors.NonExistentTextBufferProxyException(errMessage);
    }
    return [textBufferProxy, crdt];
  }
}
module.exports = HostPortalBinding;
