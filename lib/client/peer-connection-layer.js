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
const config = require('./../config.js')

// Constants
const _MAX_SEND_MESSAGE_RETRIES = 10;

//////////////////////////// LOGGING AND EXCEPTIONS ////////////////////////////
log.setLevel(config.logLevels.models);

const _START_TIME = Date.now();
function logTrace(message) {
  log.trace(`${Date.now() - _START_TIME}: ` + message);
}

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
    this.rtcDataChannels = new Map();
    // Reference to WebSocket connection to server
    this.serverConnection = null;
    // Unique Peer ID for assigned by signalling server
    this.localPeerId;
    // Queues (arrays) for outgoing messages for each RTCDataChannel
    this.sendQueues = new Map();
    // ICE Servers
    this.iceServers = [
      {urls: 'stun:stun.l.google.com:19302'},
      {urls: 'stun:stun1.l.google.com:19302'},
      {urls: 'stun:stun2.l.google.com:19302'},
      {urls: 'stun:stun.services.mozilla.com'}
    ];
    // Used so this module can present a public event-based API
    this.emitter = new Emitter();
    // Initialisation promises
    this.rtcPeerConnectionInitPromises = new Map();
    this.rtcDataChannelInitPromises = new Map();
    // Peer IDs that have made calls to this peer
    this.remoteCallerPeerIds = new Set();
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
  sendToServer(message) {
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
      return;
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
        this.emitter.emit('did-emit-message', message);
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

  /** PEER CONNECTIONS */

  /**
   * Public function to connect to a peer and open up a data channel to that
   * peer
   */
  async connectToPeer(targetPeerId) {
    log.debug('Connecting to peer: ', {targetPeerId: targetPeerId});

    // Create initialisation promises
    let resolvePeerConnInitPromise;
    let resolveDataChannelInitPromise;
    const peerConnectionInitialised= new Promise((resolve) => {
      resolvePeerConnInitPromise = resolve;
    });
    const dataChannelInitialised = new Promise((resolve) => {
      resolveDataChannelInitPromise = resolve;
    });
    this.rtcPeerConnectionInitPromises.set(
      targetPeerId, peerConnectionInitialised
    );
    this.rtcDataChannelInitPromises.set(targetPeerId, dataChannelInitialised);

    // Create peer connection
    const peerConnection =
      await this._createRtcPeerConnection(
        targetPeerId, resolvePeerConnInitPromise
      );
    log.debug('RTCPeerConnection: ', {peerConnection: peerConnection});
    await peerConnectionInitialised;

    // Create data channel
    const dataChannel =
      await this._createRtcDataChannel(
        targetPeerId, resolveDataChannelInitPromise
      );
    log.debug('RTCDataChannel: ', {dataChannel: dataChannel});
    await dataChannelInitialised;

    return targetPeerId;
  }

  /**
   * Create RTCDataChannel to the peer with the specified ID
   */
  _createRtcDataChannel(targetPeerId, resolveDataChannelInitPromise) {
    log.debug('Creating WebRTC data channel: ', {targetPeerId: targetPeerId});

    return new Promise((resolve, reject) => {
      const dataChannelName = `dataChannel-${this.localPeerId}-${targetPeerId}`;

      // Get peer connection
      const peerConnection = this.rtcPeerConnections.get(targetPeerId);

      if (!peerConnection) {
        const logObj = {targetPeerId: targetPeerId};
        let errMsg = 'Undefined or null RTCPeerConnection for peer: ';
        errMsg += JSON.stringify(logObj);
        log.error(errMsg);
        reject(errMsg);
        return;
      }

      // Create RTCDataChannel
      const dataChannel = peerConnection.createDataChannel(dataChannelName);
      this.rctDataChannels.set(targetPeerId, dataChannel);

      const statusChangeHandler = (event) => {
        log.debug('RTCDataChannel status change: ', {event: event});

        switch (event.readyState) {
          case 'connecting':
            break;
          case 'open':
            resolveDataChannelInitPromise();
            break;
          case 'closing':
          case 'closed':
            break;
          default:
            break;
        }
      };

      dataChannel.onopen = statusChangeHandler;
      dataChannel.onclose = statusChangeHandler;
      dataChannel.onmessage = this._handleMessageOverDataChannel.bind(this);
      resolve(dataChannel);
    });
  }

  /**
   * Create and RTCPeerConnection to the peer at the given ID.
   */
  async _createRtcPeerConnection(targetPeerId, resolvePeerConnInitPromise) {
    log.debug('Creating RTCPeerConnection: ', {targetPeerId: targetPeerId});

    const config = {
      iceServers: this.iceServers
    };
    logTrace('Creating RTCPeerConnection object');
    this.rtcPeerConnections.set(targetPeerId, new RTCPeerConnection(config));
    let peerConnection = this.rtcPeerConnections.get(targetPeerId);

    // Setup event handlers for the newly created RTCPeerConnection

    // Fires when aggregrate state of connection changes
    peerConnection.onconnectionstatechange = (event) => {
      const logObj = {
        event: event,
        connectionState: peerConnection.connectionState
      };
      log.debug('RTCPeerConnection connection state change: ', logObj);

      switch (peerConnection.connectionState) {
        case 'new':
          break;
        case 'connecting':
          break;
        case 'connected':
          resolvePeerConnInitPromise();
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          break;
        default:
          break;
      }
    };

    // Fires when local ICE agent needs to send a new candidate to remote peer
    peerConnection.onicecandidate = (event) => {
      const logObj = {event: event};
      log.debug('RTCPeerConnection local ICE candidate generated: ', logObj);

      // RTCIceCandidate object
      const iceCandidate = event.candidate;

      if (peerConnection.canTrickleIceCandidates) {
        if (iceCandidate) {
          log.debug('Generated ICE candidate.');
          const msg = {
            type: NEW_ICE_CANDIDATE,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            iceCandidate: iceCandidate
          };
          this.sendToServer(msg);
        } else {
          const logObj = {targetPeerId: targetPeerId};
          log.debug('All ICE candidates sent to peer: ', logObj);
        }
      } else {
        log.debug(
          'RTCPeerConnection cannot trickle ICE candidates: ',
          {RTCPeerConnection: peerConnection}
        );
        // Wait for the null candidate and then send the local description's
        // SDP data
        if (!iceCandidate) {
          log.debug(
            'RTCPeerConnection all ICE candidates generated. Sending local' + 'offer: ', {sessionDescription: peerConnection.localDescription}
          );
          const msg = {
            type: SESSION_OFFER,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            sessionDescription: peerConnection.localDescription,
          };
          this.sendToServer(msg);
        }
      }
    };

    // Fires when state of the connection's ICE agent changes.
    peerConnection.oniceconnectionstatechange = async (event) => {
      const logObj = {
        event: event,
        iceConnectionState: peerConnection.iceConnectionState
      };
      log.debug('RTCPeerConnection ICE connection state change: ', logObj);

      switch (peerConnection.iceConnectionState) {
        case 'new':
          break;
        case 'checking':
          // IMPORTANT NOTE: ICE Candidate Trickling not supported, so must
          // re-send SDP offer but with ICE candidates this time.
          try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          const msg = {
            type: SESSION_OFFER,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            sessionDescription:
              encodeURIComponent(
                JSON.stringify(peerConnection.localDescription)
              ),
          };

          if (peerConnection.signalingState !== 'have-local-offer') {
            let info = 'Local RTCPeerConnection set local description from ';
            info += 'locally created offer and so expected signaling state ';
            info += 'to indicate presence of local offer: ';
            const logObj_2 = {
              expectedSignalingState: 'have-local-offer',
              actualSignalingState: peerConnection.signalingState,
              peerConnection: peerConnection,
            };
            log.error(info, logObj_2);
            return;
          }

          this.sendToServer(msg);
          } catch (err) {
            log.error(err.stack);
          }
          break;
        case 'connected':
        case 'completed':
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
      const logObj = {
        event: event,
        signalingState: peerConnection.signalingState
      };
      log.debug('RTCPeerConnection signalling state change: ', logObj);
    };

    // MISCELLANOUS

    // Fires when RTCDataChannel is added to this connection by a remote peer
    peerConnection.ondatachannel = (event) => {
      let info = 'RTCPeerConnection received RTCDataChannel endpoint ';
      info += 'from remote peer: ';
      log.debug(info, {event: event});

      const dataChannel = event.channel;
      if (this.rtcDataChannels.has(targetPeerId)) {
        log.warn(
          'Replacing RTCDataChannel to peer: ', {targetPeerId: targetPeerId}
        );
      }
      this.rtcDataChannels.set(targetPeerId, dataChannel);

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
      const logObj = {
        event: event,
        iceGatheringState: peerConnection.iceGatheringState
      };
      log.debug(
        'RTCPeerConnection ICE candidate gathering state change: ', logObj
      );
    };

    // Fires when an identity assertion is created, or during the creation of
    // an offer or an answer
    peerConnection.onidentityresult = (event) => {
      const logObj = {event: event};
      log.debug('RTCPeerConnection identity assertion created: ', logObj);

    };

    // Fires when connection's identity provider encounters an error while
    // generating an identity assertion
    peerConnection.onidpassertionerror = (event) => {
      const logObj = {event: event};
      log.debug('RTCPeerConnection identity assertion error: ', logObj);
    };

    // Fires when the connection's identity provider encounters an error while
    // validating an identity assertion
    peerConnection.onidpvalidationerror = (event) => {
      const logObj = {event: event};
      log.debug('RTCPeerConnection identity validation error: ', logObj);
    };

    // Fires when a change has occurred which requires negotitation
    peerConnection.onnegotiationneeded = async (event) => {
      log.debug(
        'RTCPeerConnection negotiation needed: ', {event: event}
      );

      // Negotiation must be carried out as offerrer.
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        const msg = {
          type: SESSION_OFFER,
          senderPeerId: this.localPeerId,
          targetPeerId: targetPeerId,
          sessionDescription:
            encodeURIComponent(JSON.stringify(peerConnection.localDescription))
        };

        if (peerConnection.signalingState !== 'have-local-offer') {
          let info = 'Local RTCPeerConnection set local description from ';
          info += 'locally created offer and so expected signaling state ';
          info += 'to indicate presence of local offer: ';
          const logObj = {
            expectedSignalingState: 'have-local-offer',
            actualSignalingState: peerConnection.signalingState,
            peerConnection: peerConnection,
          };
          log.error(info, logObj);
          return;
        }

        this.sendToServer(msg);
      } catch (err) {
        const errMessage = _createErrorMessage(err);
        log.error(errMessage);
      }
    };

    // Fires when an identity assertion, received from a peer, has been
    // successfully evaluated.
    peerConnection.onpeeridentity = (event) => {
      const logObj = {event: event};
      log.debug(
        'RTCPeerConnection successfully validated peer identity: ', logObj
      );
    };

    // Fires when a MediaStream is removed from this connection
    peerConnection.onremovestream = (event) => {
      const logObj = {event: event};
      log.debug('RTCPeerConnection removed media stream: ', logObj);
    };

    // Fires when a track has been added to the connection
    //peerConnection.ontrack = (event) => {

    //};

    // Create offer to start the signaling process
    if (!this.remoteCallerPeerIds.has(targetPeerId)) {
      // "this" peer is making the call
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        if (peerConnection.signalingState !== 'have-local-offer') {
          let info = 'Local RTCPeerConnection set local description from ';
          info += 'locally created offer and so expected signaling state ';
          info += 'to indicate presence of local offer: ';
          const logObj = {
            expectedSignalingState: 'have-local-offer',
            actualSignalingState: peerConnection.signalingState,
            peerConnection: peerConnection,
          };
          log.error(info, logObj);
          return;
        }

        if (peerConnection.canTrickleIceCandidates) {
          const msg = {
            type: SESSION_OFFER,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            sessionDescription:
              encodeURIComponent(
                JSON.stringify(peerConnection.localDescription)
              ),
          };
          this.sendToServer(msg);
        } else {
          // The event handler for the 'icecandidate' is responsible for sending
          // the offer
          const logObj = {RTCPeerConnection: this};
          log.debug(
            'RTCPeerConnection cannot trickle ICE candidates. Event handler ' +
            'for \'icecandidate\' event should send local offer upon ' +
            'gathering of all ICE candidates: ', logObj
          );
        }
      } catch (err) {
        log.error(err.stack);
      }
    }

    return peerConnection;
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

    // `validMsg.data` should be serialized
    const wrappedMsg = {
      header: {
        source: PEER,
      },
      body: deserializeMessage(validMsg.data),
    };
    this.emitter.emit('did-emit-message', wrappedMsg);
  }

  async sendMessageToPeer(message, targetPeerId, retries=0) {
    const logObj = {message: message, targetPeerId: targetPeerId};
    log.debug('Sending message to peer: ', logObj);

    this.retryingMessage = false;
    if (!message) {
      log.error('Invalid message: ', {message: message});
      return;
    }

    // Update then get a reference to the sendQueue
    if (!this.sendQueues.has(targetPeerId)) {
      this.sendQueues.set(targetPeerId, [message]);
    } else {
      let sendQueue = this.sendQueues.get(targetPeerId);
      sendQueue.push(message);
      this.sendQueues.set(targetPeerId, sendQueue);
    }
    let sendQueue = this.sendQueues.get(targetPeerId);

    // Wait until data channel is initialised
    const dataChannelInitPromise =
      this.rtcDataChannelInitPromises.get(targetPeerId);

    if (!dataChannelInitPromise) {
      const logObj = {targetPeerId: targetPeerId};
      log.error('No data channel initialisation promise for peer: ', logObj);
      return;
    }
    await dataChannelInitPromise;

    // Get data channel
    let dataChannel = this.rtcDataChannels.get(targetPeerId);
    if (!dataChannel) {
      log.error('Undefined or null data channel: ', {dataChannel: dataChannel});
      return;
    }

    // Send message if data channel is open
    switch (dataChannel.readyState) {
      case 'connecting': {
        const logObj = {
          readyState: dataChannel.readyState,
          label: dataChannel.label,
          message: message,
          targetPeerId: targetPeerId
        };
        log.error('Connection not open. Queued message: ', logObj);

        // We expect message retries should only be executed over unstable
        // connections, not on initialisation of the data channel - the latter
        // is dealt with by the initialisation promise.
        // TODO: Possibility of race condition?
        this.retryingMessage = true;
        setTimeout(() => {
          if (retries === 0 ||
              (this.retryingMessage && retries < _MAX_SEND_MESSAGE_RETRIES))
          {
            log.debug('Retrying sending of message: ', {message: message});
            this.sendMessageToPeer(message, targetPeerId, retries + 1);
          } else {
            this.retryingMessage = false;
          }
        }, 3000);
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

    //const validMsg = this._validateSessionOffer(msg);
    const validMsg = msg;
    if (!validMsg) {
      throw new InvalidSessionOfferException(JSON.stringify({message: msg}));
    }
    this.remoteCallerPeerIds.add(msg.senderPeerId);

    // Create initialisation promise
    let resolvePeerConnInitPromise;
    const promise1 = new Promise((resolve) => {
      resolvePeerConnInitPromise = resolve;
    });

    // Session description of the connection at the remote peer's end
    const remoteSessionDescription =
      JSON.parse(decodeURIComponent(msg.sessionDescription));

    try {
      logTrace('Creating RTCPeerConnection.');
      const peerConnection =
        await this._createRtcPeerConnection(
          msg.senderPeerId, resolvePeerConnInitPromise
        );
      logTrace('Setting remote description');
      await peerConnection.setRemoteDescription(remoteSessionDescription);

      if (peerConnection.signalingState !== 'have-remote-offer') {
        let info = 'Local RTCPeerConnection set remote description from ';
        info += 'remote peer\'s offer and so expected signaling state ';
        info += 'to indicate presence of remote offer: ';
        const logObj = {
          expectedSignalingState: 'have-remote-offer',
          actualSignalingState: peerConnection.signalingState,
          peerConnection: peerConnection,
        };
        log.error(info, logObj);
      }

      logTrace('Creating answer');
      const answer = await peerConnection.createAnswer();
      logTrace('Setting local description');
      await peerConnection.setLocalDescription(answer);

      const tmpExecution = () => {
        if (peerConnection.canTrickleIceCandidates) {
          return peerConnection.localDescription;
        }
        log.debug(
          'Peer cannot trickle ICE candidates. Waiting for all ICE ' +
          'candidates to be gathered before sending SDP answer.'
        );
        return new Promise((resolve) => {
          log.debug('Setting up event handler for ICE gathering state change');
          peerConnection.onicegatheringstatechange = (event) => {
            let logObj_3 = {
              event: event,
              iceGatheringState: peerConnection.iceGatheringState,
            };
            log.debug(
              'RTCPeerConnection ICE gathering state change: ', logObj_3
            );
            if (peerConnection.iceGatheringState === 'complete') {
              resolve(peerConnection.localDescription);
            }
          }
        });
      }
      const realAnswer = await tmpExecution();
      const encodedAnswer = encodeURIComponent(JSON.stringify(realAnswer));

      if (peerConnection.signalingState !== 'have-local-pranswer') {
        let info = 'Local RTCPeerConnection set local description from ';
        info += 'locally created answer and so expected signaling state ';
        info += 'to indicate presence of local provisional answer: ';
        const logObj = {
          expectedSignalingState: 'have-local-pranswer',
          actualSignalingState: peerConnection.signalingState,
          peerConnection: peerConnection,
        };
        log.error(info, logObj);
      }

      logTrace('Constructing offer reply');
      const reply = {
        type: SESSION_ANSWER,
        senderPeerId: this.localPeerId,
        targetPeerId: msg.senderPeerId,
        sessionDescription: encodedAnswer,
      };
      logTrace('Sending offer reply to signalling server');
      this.sendToServer(reply);
    } catch (err) {
      log.error(err.stack);
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

    //const validMsg = this._validateSessionAnswer(msg);
    const validMsg = msg;
    if (!validMsg) {
      throw new InvalidSessionAnswerException(JSON.stringify({message: msg}));
    }

    const remoteSessionDescription =
      JSON.parse(decodeURIComponent(validMsg.sessionDescription));

    const cond = this.rtcPeerConnections.has(validMsg.senderPeerId);
    let errMessage = 'Unknown remote peer ID: ' + validMsg.senderPeerId;
    errMessage += 'Cannot accept session description answer.';
    throwOnConditionFail(cond, errMessage);

    const peerConnection = this.rtcPeerConnections.get(validMsg.senderPeerId);

    try {
      logTrace('Setting remote description');
      if (peerConnection.signalingState !== 'have-local-offer') {
        const logObj = {
          peerConnection: peerConnection,
          PeerConnectionLayer: this,
        };
        log.error(
          'Local RTCPeerConnection is receiving a remote answer ' +
          'yet has no local offer: ', logObj
        );
        return;
      }

      await peerConnection.setRemoteDescription(remoteSessionDescription);

      if (peerConnection.signalingState !== 'have-remote-pranswer') {
        let info = 'Local RTCPeerConnection set remote description from ';
        info += 'remote peer\'s answer and so expected signaling state ';
        info += 'to indicate presence of remote provisional answer: ';
        const logObj = {
          expectedSignalingState: 'have-remote-pranswer',
          actualSignalingState: peerConnection.signalingState,
          peerConnection: peerConnection,
        };
        log.error(info, logObj);
      }

      logTrace('Set remote description');
    } catch (err) {
      log.error(err.stack);
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
