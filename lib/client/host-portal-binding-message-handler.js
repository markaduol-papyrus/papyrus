'use babel';

const { CompositeDisposable } = require('atom');
const log = require('loglevel').getLogger('peer-connection-layer');
const config = require('./../config.js')

// Setup logging
log.setLevel(config.logLevels.hostPortalBindingMessageHandler);

class HostPortalBindingMessageHandler {

  /**
   * Expected parameters
   * @param {HostPortalBinding} hostPortalBinding Host portal binding
   * @param {MessageQueue} downstreamMessageQueue The message queue to which
   * messages will be published
   * @param {MessageQueue} upstreamMessageQueue The message queue from which
   * messages will be consumed
   */
  constructor(props) {
    this.hostPortalBinding = props.hostPortalBinding;
    this.downstreamMessageQueue = props.downstreamMessageQueue;
    this.upstreamMessageQueue = props.upstreamMessageQueue;
    this.subscriptions = new CompositeDisposable();
  }

  activateListeners() {
    this.subscriptions.add(this.hostPortalBinding.onEnqueueMessage(message => {
      this.downstreamMessageQueue.publish(message);
    }));

    this.subscriptions.add(
      this.upstreamMessageQueue.onDidPublishMessage(message => {
        // Connection layer does context agnostic checks, so no need to do any
        // here.
        const localPeerId = this.hostPortalBinding.getLocalPeerId();
        const {header} = message;
        if (header.targetPeerId === header.portalHostPeerId) {
          const logObj = {message: message};
          log.debug('Delivering message to host portal binding: ', logObj);
          this.hostPortalBinding.handleRemoteMessage(message);
        }
      })
    );
  }

  deactivateListeners() {
    this.subscriptions.dispose();
  }

  replaceHostPortalBinding(hostPortalBinding) {
    this.deactivateListeners();
    this.hostPortalBinding = hostPortalBinding;
    this.activateListeners();
  }

  replaceDownstreamMessageQueue(messageQueue) {
    this.deactivateListeners();
    this.downstreamMessageQueue = messageQueue;
    this.activateListeners();
  }

  replaceUpstreamMessageQueue(messageQueue) {
    this.deactivateListeners();
    this.upstreamMessageQueue = messageQueue;
    this.activateListeners();
  }

}
module.exports = HostPortalBindingMessageHandler;
