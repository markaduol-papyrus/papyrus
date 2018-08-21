'use babel';

const { CompositeDisposable } = require('atom');

class HostPortalBindingMessageHandler {

  /**
   * Expected parameters
   * @param {HostPortalBinding} hostPortalBinding Host portal binding
   * @param {MessageQueue} incomingMessageQueue The message queue to from which
   * messages will be consumed
   * @param {MessageQueue} outgoingMessageQueue The message queue to which this
   * class will publish messages
   */
  constructor(props) {
    this.hostPortalBinding = props.hostPortalBinding;
    this.incomingMessageQueue = props.incomingMessageQueue;
    this.outgoingMessageQueue = props.outgoingMessageQueue;
    this.subscriptions = new CompositeDisposable();
  }

  activateListeners() {
    this.subscriptions.add(this.hostPortalBinding.onEnqueueMessage(message => {
      this.outgoingMessageQueue.publish(message);
    }));

    this.subscriptions.add(
      this.incomingMessageQueue.onDidPublishMessage(message => {
        // Connection layer does context agnostic checks, so no need to do any
        // here.
        const localPeerId = this.hostPortalBinding.getLocalPeerId();
        const {header} = message;
        if (header.targetPeerId === localPeerId) {
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

  replaceIncomingMessageQueue(messageQueue) {
    this.deactivateListeners();
    this.incomingMessageQueue = messageQueue;
    this.activateListeners();
  }

  replaceOutgoingMessageQueue(messageQueue) {
    this.deactivateListeners();
    this.outgoingMessageQueue = messageQueue;
    this.activateListeners();
  }

}
module.exports = HostPortalBindingMessageHandler;
