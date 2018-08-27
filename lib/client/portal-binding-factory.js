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

    const downstreamMessageQueue =
      this.connectionLayer.getDownstreamMessageQueue();
    const upstreamMessageQueue =
      this.connectionLayer.getUpstreamMessageQueue();

    const messageHandlerProps = {
      hostPortalBinding: portalBinding,
      downstreamMessageQueue: downstreamMessageQueue,
      upstreamMessageQueue: upstreamMessageQueue,
    };
    const messageHandler =
      new HostPortalBindingMessageHandler(messageHandlerProps);
    messageHandler.activateListeners();
    return portalBinding;
  }

  createAndConnectGuestPortalBinding(guestPortalBindingProps) {
    const portalBinding = new GuestPortalBinding(guestPortalBindingProps);
    portalBinding.activateListeners();

    const downstreamMessageQueue =
      this.connectionLayer.getDownstreamMessageQueue();
    const upstreamMessageQueue =
      this.connectionLayer.getUpstreamMessageQueue();

    const messageHandlerProps = {
      guestPortalBinding: portalBinding,
      downstreamMessageQueue: downstreamMessageQueue,
      upstreamMessageQueue: upstreamMessageQueue,
    };
    const messageHandler =
      new GuestPortalBindingMessageHandler(messageHandlerProps);
    messageHandler.activateListeners();
    return portalBinding;
  }
}
module.exports = PortalBindingFactory;
