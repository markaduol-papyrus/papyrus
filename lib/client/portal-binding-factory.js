'use babel';

const MessageQueue = require('./message-queue.js');
const ConnectionLayer = require('./connection-layer.js');
const HostPortalBinding = require('./host-portal-binding.js');
const GuestPortalBinding = require('./guest-portal-binding.js');
const HostPortalBindingMessageHandler =
  require('./host-portal-binding-message-handler.js');
const GuestPortalBindingMessageHandler =
  require('./guest-portal-binding-message-handler.js');

class PortalBindingFactory {

  /**
   * Expected parameters
   * @param {ConnectionLayer} connectionLayer The connection layer
   */
  constructor(props) {
    this.connectionLayer = props.connectionLayer;
  }

  createAndConnectHostPortalBinding(hostPortalBindingProps) {
    const portalBinding = new HostPortalBinding(hostPortalBindingProps);
    portalBinding.activateListeners();
    const outgoingMessageQueue = this.connectionLayer.getIncomingMessageQueue();
    const incomingMessageQueue = this.connectionLayer.getOutgoingMessageQueue();
    const messageHandlerProps = {
      hostPortalBinding: portalBinding,
      incomingMessageQueue: incomingMessageQueue,
      outgoingMessageQueue: outgoingMessageQueue,
    };
    const messageHandler =
      new HostPortalBindingMessageHandler(messageHandlerProps);
    messageHandler.activateListeners();
    return portalBinding;
  }

  createAndConnectGuestPortalBinding(guestPortalBindingProps) {
    const portalBinding = new GuestPortalBinding(guestPortalBindingProps);
    const outgoingMessageQueue = this.connectionLayer.getIncomingMessageQueue();
    const incomingMessageQueue = this.connectionLayer.getOutgoingMessageQueue();
    const messageHandlerProps = {
      guestPortalBinding: portalBinding,
      incomingMessageQueue: incomingMessageQueue,
      outgoingMessageQueue: outgoingMessageQueue,
    };
    const messageHandler =
      new GuestPortalBindingMessageHandler(messageHandlerProps);
    messageHandler.activateListeners();
    return portalBinding;
  }
}
module.exports = PortalBindingFactory;
