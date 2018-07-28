// Server to Peer
const ASSIGN_PEER_ID = 'assign-peer-id';
// Peer to Server
const ACCEPTED_PEER_ID = 'accepted-peer-id';
// Peer to Peer (By way of Server)
const SESSION_OFFER = 'session-offer';
const SESSION_ANSWER = 'session-answer';
const NEW_ICE_CANDIDATE = 'new-ice-candidate';
const INSERT = 'insert'; // Insertion of a character (strings as well in v2 of
                         // CRDT)
const DELETE = 'delete'; // Deletion of a character or string
// TextBufferProxy insertion and deletion
const TEXT_BUFFER_PROXY_INSERT = 'text-buffer-proxy-insert';
const TEXT_BUFFER_PROXY_DELETE = 'text-buffer-proxy-delete';
// Type messages received over RTCDataChannel
const DATA_CHANNEL_MESSAGE = 'data-channel-message';
// From peer connection layer to controller
const LOCAL_PEER_ID = 'local-peer-id'; // Sent when peer connection layer learns
                                       // of assigned peer ID from server
const JOIN_PORTAL = 'join-portal';
const NOTIFICATION = 'notification';

module.exports = {
  ASSIGN_PEER_ID: ASSIGN_PEER_ID,
  ACCEPTED_PEER_ID: ACCEPTED_PEER_ID,
  SESSION_OFFER: SESSION_OFFER,
  SESSION_ANSWER: SESSION_ANSWER,
  NEW_ICE_CANDIDATE: NEW_ICE_CANDIDATE,
  TEXT_BUFFER_PROXY_INSERT: TEXT_BUFFER_PROXY_INSERT,
  TEXT_BUFFER_PROXY_DELETE: TEXT_BUFFER_PROXY_DELETE,
  DATA_CHANNEL_MESSAGE: DATA_CHANNEL_MESSAGE,
  LOCAL_PEER_ID: LOCAL_PEER_ID,
};
