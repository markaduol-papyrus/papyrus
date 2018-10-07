class MessageBuilder {
  constructor() {
    this.message = {};
    return this;
  }

  setHeader(header) {
    this.message.header = header;
    return this;
  }

  setBody(body) {
    this.message.body = body;
    return this;
  }

  setSubMessages(subMessages) {
    this.message.subMessages = subMessages;
    return this;
  }

  setFlag(flag) {
    this.message.flag = flag;
    return this;
  }

  setType(type) {
    this.message.type = type;
    return this;
  }

  setLocalPeerId(localPeerId) {
    this.message.localPeerId = localPeerId;
    return this;
  }

  setTextBufferProxyId(bufferProxyId) {
    this.message.textBufferProxyId = bufferProxyId;
    return this;
  }

  setStartPos(startPos) {
    this.message.startPos = startPos;
    return this;
  }

  setEndPos(endPos) {
    this.message.endPos = endPos;
    return this;
  }

  setNewText(newText) {
    this.message.newText = newText;
    return this;
  }

  setCharObject(charObject) {
    this.message.charObject = charObject;
    return this;
  }

  setSenderPeerId(senderPeerId) {
    this.message.senderPeerId = senderPeerId;
    return this;
  }

  setTargetPeerId(targetPeerId) {
    this.message.targetPeerId = targetPeerId;
    return this;
  }

  setTargetPeerIds(targetPeerIds) {
    this.message.targetPeerIds = targetPeerIds;
    return this;
  }

  setPortalHostPeerId(portalHostPeerId) {
    this.message.portalHostPeerId = portalHostPeerId;
    return this;
  }

  setPortalBinding(portalBinding) {
    this.message.portalBinding = portalBinding;
    return this;
  }

  setMessageBatch(messageBatch) {
    this.message.messageBatch = messageBatch;
    return this;
  }

  setMessageBatches(messageBatches) {
    this.message.messageBatches = messageBatches;
    return this;
  }

  setSiteId(siteId) {
    this.message.siteId = siteId;
    return this;
  }

  setSource(source) {
    this.message.source = source;
    return this;
  }

  setUsername(username) {
    this.message.username = username;
    return this;
  }

  getResult() {
    return this.message;
  }
}

module.exports = MessageBuilder;
