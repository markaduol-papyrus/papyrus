// Server to Peer
const ASSIGN_PEER_ID = 'assign-peer-id';
// Peer to Server
const ACCEPTED_PEER_ID = 'accepted-peer-id';
// Peer to Peer (By way of Server)
const SESSION_OFFER = 'session-offer';
const SESSION_ANSWER = 'session-answer';
const NEW_ICE_CANDIDATE = 'new-ice-candidate';
const INSERT = 'insert';
const INSERT_BATCH = 'insert-batch';
const DELETE_BATCH = 'delete-batch';
const DELETE = 'delete'; // Deletion of a character or string
// TextBufferProxy insertion and deletion
const TEXT_BUFFER_PROXY_INSERT = 'text-buffer-proxy-insert';
const TEXT_BUFFER_PROXY_DELETE = 'text-buffer-proxy-delete';
// Type messages received over RTCDataChannel
const DATA_CHANNEL_MESSAGE = 'data-channel-message';
// From peer connection layer to controller
const LOCAL_PEER_ID = 'local-peer-id'; // Sent when peer connection layer learns
                                       // of assigned peer ID from server
const JOIN_PORTAL_REQUEST = 'join-portal-request';
const LEAVE_PORTAL_REQUEST = 'leave-portal-request';
const NOTIFICATION = 'notification';
const SITE_ID_ASSIGNMENT = 'site-id-assignment';
const SITE_ID_ACKNOWLEDGEMENT = 'site-id-acknowledgement';
const SERVER = 'server';
const PEER = 'peer';
const JOIN_REQUEST_ACCEPTED = 'join-request-accepted';
const END_OF_BATCH = 'end-of-batch';

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
  JOIN_PORTAL_REQUEST: JOIN_PORTAL_REQUEST,
  NOTIFICATION: NOTIFICATION,
  DELETE: DELETE,
  INSERT_BATCH: INSERT_BATCH,
  DELETE_BATCH: DELETE_BATCH,
  INSERT: INSERT,
  DELETE: DELETE,
  SITE_ID_ASSIGNMENT: SITE_ID_ASSIGNMENT,
  SERVER: SERVER,
  PEER: PEER,
  JOIN_REQUEST_ACCEPTED: JOIN_REQUEST_ACCEPTED,
  SITE_ID_ACKNOWLEDGEMENT: SITE_ID_ACKNOWLEDGEMENT,
  LEAVE_PORTAL_REQUEST: LEAVE_PORTAL_REQUEST,
  END_OF_BATCH: END_OF_BATCH,
};
