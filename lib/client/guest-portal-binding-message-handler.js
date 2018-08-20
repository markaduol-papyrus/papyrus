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
        // Connection layer does context agnostic checks, so no need to do any
        // here.
        const portalHostPeerId = this.guestPortalBinding.getPortalHostPeerId();
        const {header} = message;

        if (header.senderPeerId === portalHostPeerId) {
          const localPeerId = this.guestPortalBinding.getLocalPeerId();
          if (header.targetPeerId !== localPeerId) {
            let errorMessage = 'Message\'s sender peer ID equals guest ';
            errorMessage += 'portal binding\'s portal host peer ID, but ';
            errorMessage += 'message\'s target peer ID does not equal local ';
            errorMessage += 'peer ID: ' + JSON.stringify(message);
            throw new Error(errorMessage);
          }
          this.guestPortalBinding.handleRemoteMessage(message);
        }
      })
    );
  }

  deactivateListeners() {
    this.subscriptions.dispose();
  }

  replaceGuestPortalBinding(guestPortalBinding) {
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
