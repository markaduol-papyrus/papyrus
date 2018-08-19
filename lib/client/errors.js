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

module.exports = {
  NonExistentCRDTException: NonExistentCRDTException,
  NonExistentTextBufferProxyException: NonExistentTextBufferProxyException,
  PeerConnectionCreationException: PeerConnectionCreationException,
  AssigningInvalidPeerIdException: AssigningInvalidPeerIdException,
  InvalidMessageFromServerException: InvalidMessageFromServerException,
  UnknownMessageTypeException: UnknownMessageTypeException,
  InvalidSessionOfferException: InvalidSessionOfferException,
  InvalidSessionAnswerException: InvalidSessionAnswerException,
  InvalidICECandidateException: InvalidICECandidateException,
  InvalidMessageOverDataChannelException: InvalidMessageOverDataChannelException,
};
