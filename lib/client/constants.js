// RTCDataChannel state
const DATA_CHANNEL_OPEN = 'open'
const DATA_CHANNEL_CONNECTING = 'connecting';
const DATA_CHANNEL_CLOSING = 'closing';
const DATA_CHANNEL_CLOSED = 'closed';
// RTCPeerConnection state
const PEER_CONN_NEW = 'new';
const PEER_CONN_CHECKING = 'checking';
const PEER_CONN_CONNECTED = 'connected';
const PEER_CONN_COMPLETED = 'completed';
const PEER_CONN_FAILED = 'failed';
const PEER_CONN_DISCONNECTED = 'disconnected';
const PEER_CONN_CLOSED = 'closed';

module.exports = {
  DATA_CHANNEL_OPEN,
  DATA_CHANNEL_CONNECTING,
  DATA_CHANNEL_CLOSING,
  DATA_CHANNEL_CLOSED,
  PEER_CONN_NEW,
  PEER_CONN_CHECKING,
  PEER_CONN_CONNECTED,
  PEER_CONN_COMPLETED,
  PEER_CONN_FAILED,
  PEER_CONN_DISCONNECTED,
  PEER_CONN_CLOSED
};
