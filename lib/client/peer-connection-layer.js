'use babel';

const {Emitter} = require('atom');
const ServerConfig = require('./server-config.js');
const MessageTypes = require('./message-types.js');
const {serializeMessage, deserializeMessage} = require('./message-serializer');

// Server port
const SERVER_PORT = ServerConfig.SERVER_PORT;

// Message types
const ASSIGN_PEER_ID = MessageTypes.ASSIGN_PEER_ID;
const ACCEPTED_PEER_ID = MessageTypes.ACCEPTED_PEER_ID;
const SESSION_OFFER = MessageTypes.SESSION_OFFER;
const SESSION_ANSWER = MessageTypes.SESSION_ANSWER;
const NEW_ICE_CANDIDATE = MessageTypes.NEW_ICE_CANDIDATE;
const LOCAL_PEER_ID = MessageTypes.LOCAL_PEER_ID;
const SERVER = MessageTypes.SERVER;
const PEER = MessageTypes.PEER;

// Logging
const log = require('loglevel').getLogger('peer-connection-layer');
const config = require('./../../config.js')

//////////////////////////// LOGGING AND EXCEPTIONS ////////////////////////////
log.setLevel(config.logLevels.models);

function _createErrorMessage(error) {
  return 'Error: ' + error.name + ':' + error.message;
}

/**
 * Assert condition is true and throw error with given message if not
 */
function throwOnConditionFail(condition, message) {
  if (!condition) {
    message = message || 'Assertion failed.';
    if (typeof Error !== 'undefined') {
      throw new Error(message);
    }
    throw message; // Fallback
  }
}

function PeerConnectionCreationException(message) {
  this.message = message || '';
  this.name = 'PeerConnectionCreationException';
}
PeerConnectionCreationException.prototype = Error.prototype;

function AssigningInvalidPeerIdException(message) {
  this.message = message || '';
  this.name = 'AssigningInvalidPeerIdException';
}
AssigningInvalidPeerIdException.prototype = Error.prototype;

function InvalidMessageFromServerException(message) {
  this.message = message || '';
  this.name = 'InvalidMessageFromServerException';
}
InvalidMessageFromServerException.prototype = Error.prototype;

function UnknownMessageTypeException(message) {
  this.message = message || '';
  this.name = 'UnknownMessageTypeException';
}
UnknownMessageTypeException.prototype = Error.prototype;

function InvalidSessionOfferException(message) {
  this.message = message || '';
  this.name = 'InvalidSessionOfferException';
}
InvalidSessionOfferException.prototype = Error.prototype;

function InvalidSessionAnswerException(message) {
  this.message = message || '';
  this.name = 'InvalidSessionAnswerException';
}
InvalidSessionAnswerException.prototype = Error.prototype;

function InvalidICECandidateException(message) {
  this.message = message || '';
  this.name = 'InvalidICECandidateException';
}
InvalidICECandidateException.prototype = Error.prototype;
////////////////////////////////////////////////////////////////////////////////

class PeerConnectionLayer {
  constructor() {
    log.debug('Constructing PeerConnectionLayer.');
    // Hostname TODO: Change to proper hostname of server in prod. build
    this.hostname = '127.0.0.1';
    // List of rtcPeerConnection[s] to remote users
    this.rtcPeerConnections = new Map();
    // List of RTCDataChannel[s] to remote peers indexed by username
    this.dataChannels = new Map();
    // Reference to WebSocket connection to server
    this.serverConnection = null;
    // Unique Peer ID for assigned by signalling server
    this.localPeerId;
    // Queues (arrays) for outgoing messages for each RTCDataChannel
    this.sendQueues = new Map();
    // ICE Servers
    this.iceServers = [{urls: 'stun:stun.l.google.com:19302'}];
    // Used so this module can present a public event-based API
    this.emitter = new Emitter();
  }

  /**
   * Allows observers to listen to all public messages emitted by the peer
   * connection layer.
   */
  onDidEmitMessage(callback) {
    return this.emitter.on('did-emit-message', callback);
  }

  /** WEBSOCKET SERVER FUNCTIONS **/

  /**
   * Generic startup function to be called by higher-level layer.
   */
  initialise() {
    log.debug('Initialsing peer connection layer.');

    return new Promise((resolve, reject) => {
      try {
        this._connectToServer();
        resolve(this);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Connect to WebSocket server.
   */
  _connectToServer() {
    log.debug('Connecting to server.');

    const appProtocol = 'ws';
    const serverUrl = appProtocol + '://' + this.hostname + ':' + SERVER_PORT;
    log.info('Connecting to server: ' + serverUrl);
    this.serverConnection = new WebSocket(serverUrl, 'json');
    this.serverConnection.onopen = this._handleServerConnectionOpen.bind(this);
    this.serverConnection.onmessage = this._handleMessageFromServer.bind(this);
  }

  /**
   * Send a message to the server
   */
  _sendToServer(message) {
    log.debug('Sending message to server: ', {message: message});

    let msgString = serializeMessage(message);
    if (this.serverConnection === undefined || this.serverConnection === null) {
      log.info('Server connection closed.');
    } else {
      this.serverConnection.send(msgString);
    }
  }

  /**
   * Handler that handles the 'open' event of a WebSocket connection. This
   * event fires when a connection to the server is opened.
   */
  _handleServerConnectionOpen(event) {
    log.debug('Handling open server connection: ', {event: event});
    log.info('Server connection open.');
  }

  /**
   * Do data validation on data from server
   */
  _validateMessageFromServer(message) {
    log.debug('Validating message from server: ', {message: message});
    if (!message) {
      log.error('Undefined or null message from server: ', {message: message});
      return;
    }
    if (!message.data) {
      log.error('Expected message to have "data" key: ', {message: message});
    }
    const parsedMsg = deserializeMessage(message.data);
    if (!parsedMsg.type) {
      const logObj = {message: message, parsedMessage: parsedMsg};
      log.error(
        'Expected message parsed from "data" key to have "type" key: ', logObj
      );
      return;
    }
    return message;
  }

  /**
   * Handler that handles the 'message' event of a WebSocket connection. This
   * event fires when a message is received from the WebSocket server.
   */
  _handleMessageFromServer(message) {
    log.debug('Handling message from server: ', {message: message});

    const validMsg = this._validateMessageFromServer(message);
    if (!validMsg) {
      let errMsg = 'Undefined or null message: ';
      errMsg += JSON.stringify({message: message});
      throw new InvalidMessageFromServerException(errMsg);
    }

    const msg = deserializeMessage(validMsg.data);
    switch (msg.type) {
      // Server has assigned this peer a unique ID amongst all peers that have
      // registered (or will register) with the server
      case ASSIGN_PEER_ID: {
        this._acceptPeerId(msg.assignedPeerId);

        const message = {
          header: {
            source: SERVER,
          },
          body: {
            type: LOCAL_PEER_ID,
            localPeerId: this.localPeerId,
          },
        };
        const serializedMsg = serializeMessage(message);
        this.emitter.emit('did-emit-message', serializedMsg);
        break;
      }
      // Offer from a remote peer to establish a peer-to-peer session.
      case SESSION_OFFER: {
        this._handleSessionOffer(msg);
        break;
      }
      // Answer by remote peer to our offer to establish a peer-to-peer session.
      case SESSION_ANSWER: {
        this._handleSessionAnswer(msg);
        break;
      }
      // ICE candidate received from remote peer
      case NEW_ICE_CANDIDATE: {
        this._handleNewICECandidate(msg);
        break;
      }
      default: {
        log.error('Unknown message type: ', msg.type);
        const errMsg = JSON.stringify({message: message, parsedMessage: msg});
        throw new UnknownMessageTypeException(errMsg);
      }
    }
  }

  /** HANDLERS FOR SIGNALLING MESSAGES */

  /**
   * Validate message containing session offer
   */
  _validateSessionOffer(message) {
    log.debug('Validating session offer: ', {message: message});
    if (!message) {
      log.error('Undefined or null message: ', {message: message});
      return;
    }
    if (message.type !== SESSION_OFFER) {
      log.error(
        'Invalid type in "session offer" message: ', {message: message}
      );
      return;
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      const logObj = {message: message};
      log.error('Invalid sender peer ID in "session offer" message: ', logObj);
      return;
    }
    if (!message.targetPeerId || message.targetPeerId !== this.localPeerId) {
      const logObj = {message: message};
      log.error('Invalid target peer ID in "session offer" message: ', logObj);
      return;
    }
    if (!message.sessionDescription) {
      const logObj = {message: message};
      log.error(
        'Invalid session description in "session offer" message: ', logObj
      );
      return;
    }
    return message;
  }

  /**
   * Handle offer to establish data channel
   */
  async _handleSessionOffer(msg) {
    log.debug('Handling session offer: ', {message: msg});

    const validMsg = this._validateSessionOffer(msg);
    if (!validMsg) {
      throw new InvalidSessionOfferException(JSON.stringify({message: msg}));
    }

    // Session description of the connection at the remote peer's end
    const remoteSessionDescription = msg.sessionDescription;

    try {
      const peerConnection =
        await this._createRtcPeerConnection(message.senderPeerId);
      await peerConnection.setRemoteDescription(remoteSessionDescription);
      const answer = await peerConnection.createAnswer(peerConnection);
      await peerConnection.setLocalDescription(answer);
      const reply = {
        type: SESSION_ANSWER,
        senderPeerId: this.localPeerId,
        targetPeerId: msg.senderPeerId,
        sessionDescription: peerConnection.localDescription,
      };
      this._sendToServer(reply);
    } catch (err) {
      const errMessage = _createErrorMessage(err);
      log.error(errMessage);
    }
  }

  /**
   * Validate message containing session answer
   */
  _validateSessionAnswer(message) {
    log.debug('Validating session answer: ', {message: message});
    if (!message) {
      log.error('Undefined or null message: ', {message: message});
      return;
    }
    if (message.type !== SESSION_ANSWER) {
      log.error(
        'Invalid type in "session answer" message: ', {message: message}
      );
      return;
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      const logObj = {message: message};
      log.error('Invalid sender peer ID in "session answer" message: ', logObj);
      return;
    }
    if (!message.targetPeerId || message.targetPeerId !== this.localPeerId) {
      const logObj = {message: message};
      log.error(
        'Invalid target peer ID in "session answer" message: ', logObj
      );
      return;
    }
    if (!message.sessionDescription) {
      const logObj = {message: message};
      log.error(
        'Invalid session description in "session answer" message: ', logObj
      );
      return;
    }
    return message;
  }

  /**
   * Handle answer received from callee in response to local peer's offer to
   * establish an RTCDataChannel.
   */
  async _handleSessionAnswer(msg) {
    log.debug('Handling session answer: ', {message: msg});

    const validMsg = this._validateSessionAnswer(msg);
    if (!validMsg) {
      throw new InvalidSessionAnswerException(JSON.stringify({message: msg}));
    }

    const remoteSessionDescription = msg.sessionDescription;

    const cond = this.rtcPeerConnections.has(msg.senderPeerId);
    let errMessage = 'Unknown remote peer ID: ' + msg.senderPeerId;
    errMessage += 'Cannot accept session description answer.';
    throwOnConditionFail(cond, errMessage);

    const peerConnection = this.rtcPeerConnections.get(msg.senderPeerId);

    try {
      await peerConnection.setRemoteDescription(remoteSessionDescription);
    } catch (err) {
      const errMessage = _createErrorMessage(err);
      log.error(errMessage);
    }
  }

  /**
   * Validate message containing new ICE candidate
   */
  _validateNewICECandidate(message) {
    log.debug('Validating new ICE candidate: ', {message: message});
    if (!message) {
      log.error('Undefined or null message: ', {message: message});
      return;
    }
    if (message.type !== NEW_ICE_CANDIDATE) {
      log.error(
        'Invalid type in "new ICE candidate" message: ', {message: message}
      );
      return;
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      const logObj = {message: message};
      log.error('Invalid sender peer ID in "session answer" message: ', logObj);
      return;
    }
    if (!message.targetPeerId || message.targetPeerId !== this.localPeerId) {
      const logObj = {message: message};
      log.error(
        'Invalid target peer ID in "new ICE candidate" message: ', logObj
      );
      return;
    }
    if (!message.iceCandidate) {
      const logObj = {message: message};
      log.error(
        'Invalid ICE candidate in "new ICE candidate" message: ', logObj
      );
      return;
    }
    return message;
  }

  /**
   * Handle ICE candidate received from remote peer. ICE (Interactive
   * Connectivity Establishment) candidates are used to negotitate the
   * establishment of an interactive peer-to-peer connection between two peers.
   */
  async _handleNewICECandidate(msg) {
    log.debug('Handling new ICE candidate: ', {message: msg});

    const validMsg = this._validateNewICECandidate(msg);
    if (!validMsg) {
      throw new InvalidICECandidateException(JSON.stringify({message: msg}));
    }

    // RTCIceCandidate object
    const candidate = validMsg.iceCandidate;
    const cond = this.rtcPeerConnections.has(validMsg.senderPeerId);
    let errMessage = 'Unknown remote peer ID: ' + validMsg.senderPeerId;
    errMessage += ' Cannot accept session description answer.';
    throwOnConditionFail(cond, errMessage);

    const peerConnection = this.rtcPeerConnections.get(validMsg.senderPeerId);

    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      const errMessage = _createErrorMessage(err);
      log.error(errMessage);
    }
  }

  /** PEER CONNECTIONS */

  /**
   * Public function to connect to a peer
   */
  connectToPeer(targetPeerId) {
    log.debug('Connecting to peer: ', {targetPeerId: targetPeerId});

    return new Promise((resolve, reject) => {
      this._createRtcPeerConnection(targetPeerId);
      resolve(targetPeerId);
    });
  }

  /**
   * Create RTCDataChannel to the peer with the specified ID
   */
  _createDataChannel(targetPeerId) {
    log.debug('Creating WebRTC data channel: ', {targetPeerId: targetPeerId});

    let dataChannelName = `dataChannel-${this.localPeerId}-${targetPeerId}`;
    let peerConnection = this.rtcPeerConnections.get(targetPeerId);

    // Check RTCPeerConnection exists
    if (!peerConnection) {
      const logObj = {targetPeerId: targetPeerId};
      log.error('Undefined or null RTCPeerConnection for peer: ', logObj);
      return;
    }

    // Create RTCDataChannel
    let dataChannel = peerConnection.createDataChannel(dataChannelName);
    this.dataChannels.set(targetPeerId, dataChannel);

    let statusChangeHandler = (event) => {
      log.debug('RTCDataChannel status change: ', {event: event});
    };

    dataChannel.onopen = statusChangeHandler;
    dataChannel.onclose = statusChangeHandler;
    dataChannel.onmessage = this._handleMessageOverDataChannel.bind(this);
  }

  /**
   * Create and RTCPeerConnection to the peer at the given ID.
   */
  _createRtcPeerConnection(targetPeerId) {
    log.debug('Creating RTCPeerConnection: ', {targetPeerId: targetPeerId});

    return new Promise((resolve) => {
      const config = {
        iceServers: this.iceServers
      };
      const peerConnection = new RTCPeerConnection(config);
      this.rtcPeerConnections.set(targetPeerId, peerConnection);

      // Setup event handlers for the newly created RTCPeerConnection

      // CONNECTION STATE CHANGES

      // Fires when aggregrate state of connection changes
      peerConnection.onconnectionstatechange = (event) => {
        const logObj = {event: event};
        log.debug('RTCPeerConnection connection state change: ', logObj);

        const connState = peerConnection.connectionState;
        const dataChannel = this.dataChannels.get(targetPeerId);
        if (connState === 'connected' && !dataChannel) {
          this._createDataChannel(targetPeerId);
        }
      }

      // Fires when local ICE agent needs to send a new candidate to remote peer
      peerConnection.onicecandidate = (event) => {
        const logObj = {event: event};
        log.debug('RTCPeerConnection local ICE candidate received: ', logObj);

        // RTCIceCandidate object
        const iceCandidate = event.candidate;

        if (iceCandidate) {
          log.debug('Generated ICE candidate.');
          const msg = {
            type: NEW_ICE_CANDIDATE,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            iceCandidate: iceCandidate
          };
          this._sendToServer(msg);
        } else {
          const logObj = {targetPeerId: targetPeerId};
          log.debug('All ICE candidates sent to peer: ', logObj);
        }
      };

      // Fires when state of the connection's ICE agent changes.
      peerConnection.oniceconnectionstatechange = (event) => {
        const logObj = {event: event};
        log.debug('RTCPeerConnection ICE connection state change: ', logObj);

        switch (peerConnection.iceConnectionState) {
          case 'failed':
          case 'disconnected':
          case 'closed':
            // TODO: Close any media streams
            break;
        }
      };

      // Fires when peer connection's signalling state changes (as a result of
      // setting a local or remote description)
      peerConnection.onsignalingstatechange = (event) => {
        const logObj = {event: event};
        log.debug('RTCPeerConnection signalling state change: ', logObj);
      };

      // MISCELLANOUS

      // Fires when RTCDataChannel is added to this connection by a remote peer
      peerConnection.ondatachannel = (event) => {
        let info = 'RTCPeerConnection received RTCDataChannel endpoint ';
        info += 'from remote peer: ';
        log.debug(info, {event: event});

        const dataChannel = event.channel;
        if (this.dataChannels.has(targetPeerId)) {
          log.warn(
            'Replacing RTCDataChannel to peer: ', {targetPeerId: targetPeerId}
          );
        }
        this.dataChannels.set(targetPeerId, dataChannel);

        // Setup event handlers
        let statusChangeHandler = (event) => {
          let info = 'RTCPeerConnection handling RTCDataChannel';
          info += ' status change: ';
          log.debug(info, {event: event});
        };

        dataChannel.onopen = statusChangeHandler;
        dataChannel.onclose = statusChangeHandler;
        dataChannel.onmessage = this._handleMessageOverDataChannel.bind(this);
      };

      // Fires when ICE gathering state changes
      peerConnection.onicegatheringstatechange = (event) => {
        const logObj = {event: event};
        log.debug(
          'RTCPeerConnection ICE candidate gathering state change: ', logObj
        );
      };

      // Fires when an identity assertion is created, or during the creation of
      // an offer or an answer
      peerConnection.onidentityresult = (event) => {

      };

      // Fires when connection's identity provider encounters an error while
      // generating an identity assertion
      peerConnection.onidpassertionerror = (event) => {

      };

      // Fires when the connection's identity provider encounters an error while
      // validating an identity assertion
      peerConnection.onidpvalidationerror = (event) => {

      };

      // Fires when a change has occurred which requires negotitation
      peerConnection.onnegotationneeded = async (event) => {
        log.debug('RTCPeerConnection negotitation needed: ', {event: event});

        // Negotiation must be carried out as offerrer.
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          const msg = {
            type: SESSION_OFFER,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            sessionDescription: peerConnection.localDescription
          };
          this._sendToServer(msg);
        } catch (err) {
          const errMessage = _createErrorMessage(err);
          log.error(errMessage);
        }
      };

      // Fires when an identity assertion, received from a peer, has been
      // successfully evaluated.
      peerConnection.onpeeridentity = (event) => {

      };

      // Fires when a MediaStream is removed from this connection
      peerConnection.onremovestream = (event) => {

      };

      // Fires when a track has been added to the connection
      //peerConnection.ontrack = (event) => {

      //};
      resolve(peerConnection)
    });
  }

  _validateMessageOverDataChannel(message) {
    log.debug('Validating data channel message: ', {message: message});
    if (!message) {
      log.error('Undefined or null message: ', {message: message});
      return;
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      const logObj = {message: message};
      log.error(
        'Invalid sender peer ID in message over data channel: ', logObj
      );
      return;
    }
    if (!message.targetPeerId && !message.targetPeerIds) {
      const logObj = {message: message};
      log.error('No target peer ID(s) in message over data channel: ', logObj);
      return;
    }
    if (!message.type) {
      const logObj = {message: message};
      log.error('No message type in message over data channel: ', logObj);
      return;
    }
    return message;
  }

  _handleMessageOverDataChannel(message) {
    log.debug('Handling message over data channel: ', {message: message});

    const validMsg = this._validateMessageOverDataChannel(message);
    if (!validMsg) {
      const errMsg = JSON.stringify({message: message})
      throw new InvalidMessageOverDataChannelException(errMsg);
    }

    // `event.data` should be serialized
    const wrappedMsg = {
      header: {
        source: PEER,
      },
      body: deserializeMessage(validMsg.data),
    };
    this.emitter.emit('did-emit-message', wrappedMsg);
  }

  sendMessageToPeer(message, targetPeerId) {
    const logObj = {message: message, targetPeerId: targetPeerId};
    log.debug('Sending message to peer: ', logObj);

    if (!message) {
      log.error('Invalid message: ', {message: message});
      return;
    }
    // Update then get a reference to the sendQueue
    this.sendQueues.get(targetPeerId).push(message);
    let sendQueue = this.sendQueues.get(targetPeerId);

    let dataChannel = this.dataChannels.get(targetPeerId);

    switch (dataChannel.readyState) {
      case 'connecting': {
        const logObj = {
          readyState: dataChannel.readyState,
          label: dataChannel.label,
          message: message,
          targetPeerId: targetPeerId
        };
        log.error('Connection not open. Queued message: ', logObj);
        break;
      }

      case 'open': {
        const logObj = {
          readyState: dataChannel.readyState,
          label: dataChannel.label,
          message: message,
          targetPeerId: targetPeerId
        };
        log.debug('Sending message over data channel: ', logObj);

        if (sendQueue.length > 1) {
          log.debug(
            'Also sending messages in queue: ', {length: sendQueue.length}
          );
        }
        sendQueue.forEach(msg => dataChannel.send(msg));
        this.sendQueues.set(targetPeerId, []);
        break;
      }

      case 'closing': {
        const logObj = {
          readyState: dataChannel.readyState,
          label: dataChannel.label
        };
        log.error('Attempting to send message over closing channel: ', logObj);
        break;
      }

      case 'closed': {
        const logObj = {
          readyState: dataChannel.readyState,
          label: dataChannel.label
        };
        log.error('Attempted to send message over closed channel: ', logObj);
        break;
      }

      default: {
        const logObj = {readyState: dataChannel.readyState};
        log.error('Unexpected RTCDataChannel "readyState": ', logObj);
        break;
      }
    }
  }

  /** HELPER FUNCTIONS **/

  /**
   * Do some sanity checks on the given `peerId` and if all is well, set it as
   * the (unique) peer ID of this peer (as stored in this PeerConnectionLayer
   * class).
   */
  _acceptPeerId(peerId) {
    log.debug('Accepting peer ID: ', {peerId: peerId});

    if (!(this.localPeerId === undefined || this.localPeerId === null)) {
      log.warn(
        'Assigning new peer ID to peer with exising ID: ',
        {peerId: this.localPeerId}
      );
    }
    if (peerId === undefined || peerId === null) {
      const errMessage = `Cannot assign peer ID: "${peerId}" to a peer.`;
      throw new AssigningInvalidPeerIdException(errMessage);
    }
    this.localPeerId = peerId;
  }
}

module.exports = PeerConnectionLayer;
