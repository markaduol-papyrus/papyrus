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

module.exports = {
  ASSIGN_PEER_ID: ASSIGN_PEER_ID,
  ACCEPTED_PEER_ID: ACCEPTED_PEER_ID,
  SESSION_OFFER: SESSION_OFFER,
  SESSION_ANSWER: SESSION_ANSWER,
  NEW_ICE_CANDIDATE: NEW_ICE_CANDIDATE,
};
