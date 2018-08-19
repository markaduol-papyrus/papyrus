'use babel';

const { CompositeDisposable } = require('atom');

class GuestPortalBindingMessageHandler{

  /**
   * Expected parameters
   * @param {GuestPortalBinding} guestPortalBinding Guest portal binding
   * @param {MessageQueue} incomingMessageQueue The message queue to from which
   * messages will be consumed
   * @param {MessageQueue} outgoingMessageQueue The message queue to which this
   * class will publish messages
   */
  constructor(props) {
    this.guestPortalBinding = props.guestPortalBinding;
    this.incomingMessageQueue = props.incomingMessageQueue;
    this.outgoingMessageQueue = props.outgoingMessageQueue;
    this.subscriptions = new CompositeDisposable();
  }

  activateListeners() {
    this.subscriptions.add(this.guestPortalBinding.onEnqueueMessage(message => {
      this.outgoingMessageQueue.publish(message);
    }));

    this.subscriptions.add(
      this.incomingMessageQueue.onDidPublishMessage(message => {
        this.guestPortalBinding.handleRemoteMessage(message);
      })
    );
  }

  deactivateListeners() {
    this.subscriptions.dispose();
  }

  replaceHostPortalBinding(hostPortalBinding) {
    this.deactivateListeners();
    this.guestPortalBinding = guestPortalBinding;
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
module.exports = GuestPortalBindingMessageHandler;
