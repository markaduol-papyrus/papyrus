class MessageBuilder {
  constructor() {
    this.message;
  }

  setType(type) {
    this.message.type = type;
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

  getResult() {
    return this.message;
  }
}

module.exports = MessageBuilder;
