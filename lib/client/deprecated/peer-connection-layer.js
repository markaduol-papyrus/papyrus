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

function InvalidMessageOverDataChannelException(message) {
  this.message = message || '';
  this.name = 'InvalidMessageOverDataChannelException';
}
InvalidMessageOverDataChannelException.prototype = Error.prototype;
////////////////////////////////////////////////////////////////////////////////

class PeerConnectionLayer {

  /**
   * Expected parameters
   * @param {MessageQueue} incomingMessageQueue Message queue from which
   * messages will be consumed
   * @param {MessageQueue} outgoingMessageQueue Message queue to which messages
   * should be published
   */
  constructor(props) {
    log.debug('Constructing PeerConnectionLayer.');

    this.incomingMessageQueue = props.incomingMessageQueue;
    this.outgoingMessageQueue = props.outgoingMessageQueue;
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
      {urls: 'stun:stun.services.mozilla.com'},
    ];
    // Used so this module can present a public event-based API
    this.emitter = new Emitter();
    // Initialisation promises
    this.rtcDataChannelInitPromises = new Map();
    // Peer IDs that have made calls to this peer
    this.remoteCallerPeerIds = new Set();
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
        this.incomingMessageQueue.onDidPublishMessage(message => {
          const {targetPeerId, targetPeerIds} = message.header;
          if (targetPeerId) {
            this.sendMessageToPeer(message, targetPeerId);
          } else {
            for (const peerId of targetPeerIds) {
              this.sendMessageToPeer(message, targetPeerIds);
            }
          }
        });
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

    let errorMessage;
    let logObj = {message: message};
    let invalidMessageFromServer = false;
    if (!message) {
      invalidMessageFromServer = true;
      errorMessage = 'Undefined or null message from server: ';
    }
    if (!message.data) {
      invalidMessageFromServer = true;
      errorMessage = 'Expected message to have "data" key: ';
    }
    const parsedMsg = deserializeMessage(message.data);
    if (!parsedMsg.type) {
      invalidMessageFromServer = true;
      logObj = {message: message, parsedMessage: parsedMsg};
      errorMessage = 'Expected message from parsed "data" to have "type" key: ';
    }
    if (invalidMessageFromServer) {
      errorMessage += JSON.stringify(logObj);
      log.error(errorMessage);
      throw new InvalidMessageFromServerException(errorMessage);
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
            header: {
              type: LOCAL_PEER_ID,
            },
            body: {
              localPeerId: this.localPeerId,
            }
          },
        };
        this.outgoingMessageQueue.publish(message);
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

    // Create and store initialisation promises
    let resolveDataChannelInitPromise;
    const resolveDataChannelInitialised = new Promise((resolve) => {
      resolveDataChannelInitPromise = resolve;
    });
    this.rtcDataChannelInitPromises.set(
      targetPeerId, resolveDataChannelInitialised
    );

    // Create data channel
    const dataChannel =
      await this._createRtcDataChannel(
        targetPeerId, resolveDataChannelInitPromise
      );
    log.debug('RTCDataChannel: ', {dataChannel: dataChannel});

    return targetPeerId;
  }

  /**
   * Create RTCDataChannel to the peer with the specified ID. If an
   * RTCPeerConnection to the specified peer ID does not exist, one will be
   * created and stored.
   */
  _createRtcDataChannel(targetPeerId, resolveDataChannelInitPromise) {
    log.debug('Creating WebRTC data channel: ', {targetPeerId: targetPeerId});

    return new Promise(async (resolve, reject) => {

      // Get RTCDataChannel
      let peerConnection = this.rtcPeerConnections.get(targetPeerId);
      if (!peerConnection) {
        peerConnection = await this._createRtcPeerConnection(targetPeerId);
        this.rtcPeerConnections.set(targetPeerId, peerConnection);
      }

      // Create RTCDataChannel
      const dataChannelName = `dataChannel-${this.localPeerId}-${targetPeerId}`;
      const dataChannel = peerConnection.createDataChannel(dataChannelName);
      this.rtcDataChannels.set(targetPeerId, dataChannel);

      // Setup RTCDataChannel event handlers
      const statusChangeHandler = (event) => {
        const logObj = {event: event, readyState: dataChannel.readyState};
        log.debug('RTCDataChannel state change: ', logObj);

        switch (dataChannel.readyState) {
          case 'connecting':
            break;
          case 'open':
            logTrace('RTCDataChannel open. Resolving initialsation promise.');
            resolveDataChannelInitPromise();
            break;
          case 'closing':
          case 'closed':
            break;
          default:
            break;
        }
      }

      dataChannel.onopen = statusChangeHandler;
      dataChannel.onclose = statusChangeHandler;
      dataChannel.onmessage = this._handleRTCDataChannelMessageEvent.bind(this);
      resolve(dataChannel);
    });
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

        if (iceCandidate) {
          log.debug('Generated ICE candidate.');
          const msg = {
            type: NEW_ICE_CANDIDATE,
            senderPeerId: this.localPeerId,
            targetPeerId: targetPeerId,
            iceCandidate: iceCandidate,
          };
          this.sendToServer(msg);
        } else {
          const logObj = {targetPeerId: targetPeerId};
          log.debug('All ICE candidates sent to peer: ', logObj);
        }
      };

      // Fires when state of the connection's ICE agent changes.
      peerConnection.oniceconnectionstatechange = (event) => {
        const logObj = {
          event: event,
          iceConnectionState: peerConnection.iceConnectionState
        };
        log.debug('RTCPeerConnection ICE connection state change: ', logObj);

        switch (peerConnection.iceConnectionState) {
          case 'new':
            break;
          case 'checking':
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

        // Create and store initialisation promises
        let resolveDataChannelInitPromise;
        const resolveDataChannelInitialised = new Promise((resolve) => {
          resolveDataChannelInitPromise = resolve;
        });
        this.rtcDataChannelInitPromises.set(
          targetPeerId, resolveDataChannelInitialised
        );

        const dataChannel = event.channel;
        if (this.rtcDataChannels.has(targetPeerId)) {
          log.warn(
            'Replacing RTCDataChannel to peer: ', {targetPeerId: targetPeerId}
          );
        }
        this.rtcDataChannels.set(targetPeerId, dataChannel);

        // Setup event handlers
        let statusChangeHandler = (event) => {
          const logObj = {event: event, readyState: dataChannel.readyState};
          log.debug('RTCDataChannel state change: ', logObj);

          switch (dataChannel.readyState) {
            case 'connecting':
              break;
            case 'open':
              logTrace('RTCDataChannel open. Resolving initialsation promise.');
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
        dataChannel.onmessage = this._handleRTCDataChannelMessageEvent.bind(this);
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
          this.sendToServer(msg);
        } catch (err) {
          log.error(err.stack);
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

      resolve(peerConnection);
    });
  }

  _validateMessageOverDataChannel(message) {
    log.debug('Validating data channel message: ', {message: message});

    let errorMessage;
    let invalidMessageOverDataChannel = false;
    const {header, body} = message;

    if (!message) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'Undefined or null message: ';
    }
    if (!header) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'Undefined or null message header: ';
    }
    if (!header.senderPeerId || header.senderPeerId === this.localPeerId) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'Invalid sender peer ID in message from data ';
      errorMessage += 'channel: ';
    }
    if (!header.targetPeerId && !header.targetPeerIds) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'No target peer ID(s) in message header from data ';
      errorMessage += 'channel: ';
    }
    if (header.targetPeerId && header.targetPeerIds) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'Ambigous: Message header has both "targetPeerId" and ';
      errorMessage += '"targetPeerIds" keys: ';
    }
    if (header.targetPeerId === header.senderPeerId) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'Target peer ID is equal to sender peer ID: ';
    }
    if (!header.type) {
      invalidMessageOverDataChannel = true;
      errorMessage = 'No message type in message header over data channel: ';
    }
    if (invalidMessageOverDataChannel) {
      errorMessage += JSON.stringify({message: message});
      log.error(errorMessage);
      throw new InvalidMessageOverDataChannelException(errorMessage);
    }
    return message;
  }

  _handleRTCDataChannelMessageEvent(event) {
    log.debug('Handling message over data channel: ', {event: event});

    let msgData = deserializeMessage(event.data)
    msgData = this._validateMessageOverDataChannel(msgData);

    const peerConnectionLayerMessage = {
      header: {
        source: PEER,
      },
      body: msgData,
    };
    this.outgoingMessageQueue.publish(peerConnectionLayerMessage);
  }

  async sendMessageToPeer(message, targetPeerId, retries=0) {
    const logObj = {message: message, targetPeerId: targetPeerId};
    log.debug('Sending message to peer: ', logObj);

    if (!message) {
      log.error('Invalid message: ', {message: message});
      return;
    }

    // Update then get a reference to the sendQueue
    if (!this.sendQueues.has(targetPeerId)) {
      this.sendQueues.set(targetPeerId, [message]);
    } else {
      this.sendQueues.get(targetPeerId).push(message);
    }
    let sendQueue = this.sendQueues.get(targetPeerId);

    // Wait until data channel is initialised
    const resolveDataChannelInitialised =
      this.rtcDataChannelInitPromises.get(targetPeerId);

    if (!resolveDataChannelInitialised) {
      const logObj = {
        targetPeerId: targetPeerId,
        dataChannelInitPromises: this.rtcDataChannelInitPromises
      };
      log.error('No data channel initialisation promise for peer: ', logObj);
      return;
    }
    logTrace('Waiting for signal that RTCDataChannel is initialsed.');
    await resolveDataChannelInitialised;
    logTrace('Data Channel initialised.');

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
        setTimeout(() => {
          if (retries === 0 || retries < _MAX_SEND_MESSAGE_RETRIES) {
            log.debug('Retrying sending of message: ', {message: message});
            this.sendMessageToPeer(message, targetPeerId, retries + 1);
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
        sendQueue.forEach(msg => dataChannel.send(serializeMessage(msg)));
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

    let errorMessage;
    let invalidSessionOffer = false;
    if (!message) {
      invalidSessionOffer = true;
      errorMessage = 'Undefined or null message: ';
    }
    if (message.type !== SESSION_OFFER) {
      invalidSessionOffer = true;
      errorMessage = 'Invalid type in "session offer" message: ';
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      invalidSessionOffer = true;
      errorMessage = 'Invalid sender peer ID in "session offer" message';
    }
    if (!message.targetPeerId || message.targetPeerId !== this.localPeerId) {
      invalidSessionOffer = true;
      errorMessage = 'Invalid target peer ID in "session offer" message: ';
    }
    if (!message.sessionDescription) {
      invalidSessionOffer = true;
      errorMessage = 'Invalid session description in "session offer" message: ';
    }
    if (invalidSessionOffer) {
      errorMessage += JSON.stringify({message: message});
      log.error(errorMessage);
      throw new InvalidSessionOfferException(errorMessage);
    }
    return message;
  }

  /**
   * Handle offer to establish data channel
   */
  async _handleSessionOffer(msg) {
    log.debug('Handling session offer: ', {message: msg});

    const validMsg = this._validateSessionOffer(msg);
    this.remoteCallerPeerIds.add(msg.senderPeerId);

    // Session description of the connection at the remote peer's end
    const remoteSessionDescription =
      JSON.parse(decodeURIComponent(msg.sessionDescription));

    try {
      const peerConnection =
        await this._createRtcPeerConnection(msg.senderPeerId);
      await peerConnection.setRemoteDescription(remoteSessionDescription);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      const encodedAnswer =
        encodeURIComponent(
          JSON.stringify(peerConnection.localDescription)
        );
      const reply = {
        type: SESSION_ANSWER,
        senderPeerId: this.localPeerId,
        targetPeerId: msg.senderPeerId,
        sessionDescription: encodedAnswer,
      };
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

    let invalidSessionAnswer = false;
    let errorMessage;
    if (!message) {
      invalidSessionAnswer = true;
      errorMessage = 'Undefined or null message: ';
    }
    if (message.type !== SESSION_ANSWER) {
      invalidSessionAnswer = true;
      errorMessage = 'Invalid type in "session answer" message: ';
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      invalidSessionAnswer = true;
      errorMessage = 'Invalid sender peer ID in "session answer" message: ';
    }
    if (!message.targetPeerId || message.targetPeerId !== this.localPeerId) {
      invalidSessionAnswer = true;
      errorMessage = 'Invalid target peer ID in "session answer" message: ';
    }
    if (!message.sessionDescription) {
      invalidSessionAnswer = true;
      errorMessage = 'Invalid session description in "session answer" message: '
    }
    if (invalidSessionAnswer) {
      errorMessage += JSON.stringify({message: message});
      log.error(errorMessage);
      throw new InvalidSessionAnswerException(errorMessage);
    }
    return message;
  }

  /**
   * Handle answer received from callee in response to local peer's offer to
   * establish an RTCDataChannel.
   */
  _handleSessionAnswer(msg) {
    log.debug('Handling session answer: ', {message: msg});

    const validMsg = this._validateSessionAnswer(msg);
    const remoteSessionDescription =
      JSON.parse(decodeURIComponent(validMsg.sessionDescription));

    const cond = this.rtcPeerConnections.has(validMsg.senderPeerId);
    let errMessage = 'Unknown remote peer ID: ' + validMsg.senderPeerId;
    errMessage += 'Cannot accept session description answer.';
    throwOnConditionFail(cond, errMessage);

    const peerConnection = this.rtcPeerConnections.get(validMsg.senderPeerId);

    try {
      peerConnection.setRemoteDescription(remoteSessionDescription);
    } catch (err) {
      log.error(err.stack);
    }
  }

  /**
   * Validate message containing new ICE candidate
   */
  _validateNewICECandidate(message) {
    log.debug('Validating new ICE candidate: ', {message: message});

    let errorMessage;
    let invalidIceCandidate = false;
    if (!message) {
      invalidIceCandidate = true;
      errorMessage = 'Undefined or null message: ';
    }
    if (message.type !== NEW_ICE_CANDIDATE) {
      invalidIceCandidate = true;
      errorMessage = 'Invalid type in "new ICE candidate" message: ';
    }
    if (!message.senderPeerId || message.senderPeerId === this.localPeerId) {
      invalidIceCandidate = true;
      errorMessage = 'Invalid sender peer ID in "session answer" message: ';
    }
    if (!message.targetPeerId || message.targetPeerId !== this.localPeerId) {
      invalidIceCandidate = true;
      errorMessage = 'Invalid target peer ID in "new ICE candidate" message: ';
    }
    if (!message.iceCandidate) {
      invalidIceCandidate = true;
      errorMessage = 'Invalid ICE candidate in "new ICE candidate" message: ';
    }
    if (invalidIceCandidate) {
      errorMessage += JSON.stringify({message: message});
      log.error(errorMessage);
      throw new InvalidICECandidateException(errorMessage);
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
