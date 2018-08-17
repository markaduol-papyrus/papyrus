'use babel';

const {CompositeDisposable, Emitter, Point, Range} = require('atom');
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
const SITE_ID_ASSIGNMENT = MessageTypes.SITE_ID_ASSIGNMENT;
const SITE_ID_ACKNOWLEDGEMENT = MessageTypes.SITE_ID_ACKNOWLEDGEMENT;
const JOIN_PORTAL_REQUEST = MessageTypes.JOIN_PORTAL_REQUEST;
const LEAVE_PORTAL_REQUEST = MessageTypes.LEAVE_PORTAL_REQUEST;
const JOIN_REQUEST_ACCEPTED = MessageTypes.JOIN_REQUEST_ACCEPTED;
const ACCEPTED_PEER_ID = MessageTypes.ACCEPTED_PEER_ID;
const NOTIFICATION = MessageTypes.NOTIFICATION;

// Logging
const config = require('./../config.js')
const log = require('loglevel').getLogger('host-portal-binding');

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
  log.debug('Converting positions to Range: ', logObj);

  const startPoint = [startPos.lineIndex, startPos.charIndex];
  const endPoint = [endPos.lineIndex, endPos.charIndex];
  return new Range(startPoint, endPoint);
}

/**
 * Convert the given position to an atom `Point` object
 */
function _convertPositionToPoint(position) {
  const logObj = {position: position};
  log.debug('Converting position to Point: ', logObj);

  return new Point(position.lineIndex, position.charIndex);
}
////////////////////////////////////////////////////////////////////////////////

class HostPortalBinding {
  /**
   * Expected parameters
   * @param {Object} workspace Atom workspace
   * @param {Object} notificationManager Atom notification manager
   * @param {string} username Local username
   */
  constructor(props) {
    log.debug('Constructing HostPortalBinding: ', props);
    const {workspace, notificationManager, username} = props;

    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.username = username;
    this.bufferProxiesById = new Map();
    this.crdtsById = new Map();
    this.bufferURIs = new Set();
    this.subscriptions = new CompositeDisposable();
    this.localPeerId;  // Also serves as the host portal ID
    this.siteId = 1; // Site ID used to initialise the CRDT
    this.nextSiteIdForGuest = 2; // The next site ID to use for a new guest peer
    this.emitter = new Emitter();
    this.guestPeerIds = new Set();
    // Map from peer ID of every remote peer to its metadata
    this.guestPeerMetadataByPeerId = new Map();
    // Map from site ID of every peer (incl. local peer) to its site identity
    this.siteIdentityBySiteId = new Map();
  }

  /**
   * Populate the CRDT structure of the given text buffer proxy.
   */
  _populateCRDT(bufferProxy) {
    const logObj = {bufferProxy: bufferProxy};
    log.debug('Populating CRDT: ', logObj);

    return new Promise((resolve) => {
      if (!this.siteId) {
        log.warn('Undefined site ID: ' + this.siteId);
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
    bufferProxy.onDidEmitMessage(msg => {
      this._handleLocalMessage(msg)
    });
    this.bufferProxiesById.set(id, bufferProxy);
  }

  /******************************* PUBLIC API *********************************/

  /**
   * Initialise the portal
   */
  initialise() {
    log.debug('Initialising host portal.');

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
    this.siteIdentityBySiteId.set(this.siteId, this.username);
  }

  close() {
    log.debug('Closing host portal.');

    this.subscriptions.dispose();
    this.emitter.emit('portal-closed');
  }

  onDidLocalInsert(callback) {
    return this.emitter.on('did-local-insert', callback);
  }

  onDidLocalDelete(callback) {
    return this.emitter.on('did-local-delete', callback);
  }

  onDeliveredLocalPeerId(callback) {
    return this.emitter.on('delivered-local-peer-id', callback);
  }

  onCreatedMessageForServer(callback) {
    return this.emitter.on('created-message-for-server', callback);
  }

  onReceivedJoinPortalRequest(callback) {
    return this.emitter.on('received-join-portal-request', callback);
  }

  onAcceptedJoinPortalRequest(callback) {
    return this.emitter.on('accepted-join-portal-request', callback);
  }

  onReceivedLeavePortalRequest(callback) {
    return this.emitter.on('received-leave-portal-request', callback);
  }

  onAcceptedLeavePortalRequest(callback) {
    return this.emitter.on('accepted-leave-portal-request', callback);
  }

  onPortalClosed(callback) {
    return this.emitter.on('portal-closed', callback);
  }

  onEnqueueMessage(callback) {
    return this.emitter.on('enqueue-message', callback);
  }

  onEnqueueMessageBatch(callback) {
    return this.emitter.on('enqueue-message-batch', callback);
  }

  onEnqueueMessageBatches(callback) {
    return this.emitter.on('enqueue-message-batches', callback);
  }

  hasGuestPeers() {
    log.debug('Retrieving guest peers.');
    return this.guestPeerIds.size > 0;
  }

  getGuestPeerIds() {
    log.debug('Retrieving guest peer IDs');
    return this.guestPeerIds;
  }

  getLocalPeerId() {
    log.debug('Retrieving local peer ID');
    return this.localPeerId;
  }

  /**
   * Return the site identity of the peer (local or guest) with the given site
   * ID
   */
  getSiteIdentity(siteId) {
    const logObj = {siteId: siteId};
    log.debug('Retrieving site identity: ', logObj)

    const siteIdentity = this.siteIdentityBySiteId.get(siteId);
    if (!siteIdentity) {
      log.warn('Undefined site identity for site ID: ', siteId);
    }
    return siteIdentity;
  }

  /**
   * Get site IDs of all local peers, including the local peer
   */
  getActiveSiteIds() {
    log.debug('Retrieving active site IDs');

    let siteIds = [this.siteId];
    for (
      const [peerId, metadata] of
      Object.entries(this.guestPeerMetadataByPeerId)
    )
    {
      if (!metadata.siteId) {
        log.error('Unexpected. Site ID for peer: ', peerId, ' not found.');
      } else {
        siteIds.push(metadata.siteId);
      }
    }
    return siteIds;
  }

  /********************** HIGHER-LEVEL MESSAGE HANDLERS ***********************/

  /**
   * Handle a local message (from a text buffer proxy)
   */
  _handleLocalMessage(msg) {
    const logObj = {message: msg};
    log.debug('Handling local message: ', logObj);

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
      const msgHeader = new MessageBuilder().
                        setType(INSERT).
                        setSenderPeerId(this.localPeerId).
                        setPortalHostPeerId(this.localPeerId).
                        setTargetPeerIds(this.guestPeerIds).
                        getResult();
      const msgBody = new MessageBuilder().
                      setCharObject(charObj).
                      setTextBufferProxyId(bufferProxyId).
                      getResult();
      const msg = new MessageBuilder().
                  setHeader(msgHeader).
                  setBody(msgBody).
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
                        setPortalHostPeerId(this.localPeerId).
                        setTargetPeerIds(this.guestPeerIds).
                        getResult();
      const msgBody = new MessageBuilder().
                      setCharObject(charObj).
                      setTextBufferProxyId(bufferProxyId).
                      getResult();
      const msg = new MessageBuilder().
                  setHeader(msgHeader).
                  setBody(msgBody).
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
   * Validate remote-origin message
   */
  _validateRemoteMessage(message) {
    // TODO
  }


  /**
   * Handle a message received from a remote peer or the signalling server
   */
  async handleRemoteMessage(msg) {
    const logObj = {message: msg};
    log.debug('Handling remote message: ', logObj);

    const {header, body} = msg;
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
                       getResult();
        this.emitter.emit('created-message-for-server', newMsg);
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

      case NOTIFICATION: {
        break;
      }

      case INSERT: {
        const {senderPeerId} = header;
        const {textBufferProxyId, charObject} = body;
        const bufferProxyId =
          this._stripUsernameFromBufferProxyId(textBufferProxyId);
        this._remoteInsert(bufferProxyId, charObject);
        this._forwardToGuests(senderPeerId, msg);
        break;
      }

      case DELETE: {
        const {senderPeerId} = header;
        const {textBufferProxyId, charObject} = body;
        const bufferProxyId =
          this._stripUsernameFromBufferProxyId(textBufferProxyId);
        this._remoteDelete(bufferProxyId, charObject);
        this._forwardToGuests(senderPeerId, msg);
        break;
      }

      case SITE_ID_ACKNOWLEDGEMENT: {
        const {senderPeerId, portalHostPeerId} = header;
        const {siteId, username} = body;
        await this._registerNewGuestPeer(siteId, senderPeerId, username);

        // Tell new guest peer that it's request to join this portal has been
        // accepted
        const msgHeader = new MessageBuilder().
                          setType(JOIN_REQUEST_ACCEPTED).
                          setSenderPeerId(this.localPeerId).
                          setTargetPeerId(senderPeerId).
                          setPortalHostPeerId(portalHostPeerId).
                          getResult();
        const newMsg = new MessageBuilder().
                       setHeader(msgHeader).
                       getResult();
        this.emitter.emit('accepted-join-portal-request', newMsg);
        break;
      }

      default: {
        log.error('Unknown message type: ', msg);
        log.debug('Full message: ', msg);
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

    this.notificationManager.addSuccess('New guest peer: ' + guestPeerId);
    this.guestPeerIds.add(guestPeerId);
    this.guestPeerMetadataByPeerId.set(guestPeerId, {
      siteId: guestSiteId,
      username: guestUsername,
    });
    // Site Identity is just username for now
    this.siteIdentityBySiteId.set(guestSiteId, guestUsername);
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
  _forwardToGuests(senderPeerId, msg) {
    const logObj = {senderPeerId: senderPeerId, message: msg};
    log.debug('Forwarding message to guests: ', logObj);

    let msgCopy = Object.assign({}, msg);
    let targetPeerIds = new Set(msg.header.targetPeerIds);
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

    // The first message is used to set the site ID of the new guest peer
    let messageBatches = [];
    let messageBatch = [];
    // Arbitrary
    const messageBatchSize = 16;

    // Construct message header
    const msgHeader = new MessageBuilder().
                      setType(INSERT_BATCH).
                      setSenderPeerId(this.localPeerId).
                      setPortalHostPeerId(this.localPeerId).
                      setTargetPeerId(targetPeerId).
                      getResult();

    for (const [textBufferProxyId, crdt] of this.crdstById) {
      let lineArray = crdt.getLineArray();

      for (let i = 0; i < lineArray.length; i++) {
        for (let j = 0; j < lineArray[i].length; j++) {
          const charObj = lineArray[i][j];

          const subMessage = new MessageBuilder().
                             setTextBufferProxyId(textBufferProxyId).
                             setCharObject(charObj).
                             getResult();
          messageBatch.push(subMessage);

          if (messageBatch.length % messageBatchSize === 0) {
            const msgBody = new MessageBuilder().
                            setMessageBatch(Object.assign([], messageBatch)).
                            getResult();
            const msg = new MessageBuilder().
                        setHeader(msgHeader).
                        setBody(msgBody).
                        getResult();
            messageBatches.push(msg);
            messageBatch = [];
          }
        }
      }
    }

    if (messageBatch.length > 0) {
      const msgBody = new MessageBuilder().
                      setMessageBatch(Object.assign([], messageBatch)).
                      getResult();
      const msg = new MessageBuilder().
                  setHeader(msgHeader).
                  setBody(msgBody).
                  getResult();
      messageBatches.push(msg);
      messageBatch = [];
    }
    this.emitter.emit(
      'enqueue-message-batchess', {messageBatches: messageBatches}
    );
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
