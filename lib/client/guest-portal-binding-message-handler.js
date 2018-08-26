'use babel';

const { CompositeDisposable } = require('atom');
const log = require('loglevel').getLogger('peer-connection-layer');
const config = require('./../config.js')

// Setup logging
log.setLevel(config.logLevels.guestPortalBindingMessageHandler);

class GuestPortalBindingMessageHandler {

  /**
   * Expected parameters
   * @param {GuestPortalBinding} guestPortalBinding Guest portal binding
   * @param {MessageQueue} upstreamMessageQueue The message queue from which
   * messages will be consumed
   * @param {MessageQueue} downstreamMessageQueue The message queue to which
   * messages will be published
   */
  constructor(props) {
    this.guestPortalBinding = props.guestPortalBinding;
    this.upstreamMessageQueue = props.upstreamMessageQueue;
    this.downstreamMessageQueue = props.downstreamMessageQueue;
    this.subscriptions = new CompositeDisposable();
  }

  _validateIncomingMessage(message) {
    const portalHostPeerId = this.guestPortalBinding.getPortalHostPeerId();
    const {header} = message;

    if (header.senderPeerId === portalHostPeerId) {
      const localPeerId = this.guestPortalBinding.getLocalPeerId();

      if (header.targetPeerId) {
        if (header.targetPeerId !== localPeerId) {
          let errorMessage = 'Message\'s sender peer ID equals guest ';
          errorMessage += 'portal binding\'s portal host peer ID, but ';
          errorMessage += 'message\'s target peer ID does not equal local ';
          errorMessage += 'peer ID: ' + JSON.stringify(message);
          throw new Error(errorMessage);
        }

      } else {

        let foundValidTargetPeerId = false;

        for (let i = 0; i < header.targetPeerIds.length; i++) {
          if (header.targetPeerIds[i] === localPeerId) {
            foundValidTargetPeerId = true;
            break;
          }
        }

        if (!foundValidTargetPeerId) {
          let errorMessage = 'Could not find a peer ID in message\'s list of ';
          errorMessage += 'target peer IDs that matches the local peer ID: ';
          errorMessage += JSON.stringify(message);
          throw new Error(errorMessage);
        }
      }
    }
  }

  activateListeners() {
    this.subscriptions.add(this.guestPortalBinding.onEnqueueMessage(message => {
      this.downstreamMessageQueue.publish(message);
    }));

    this.subscriptions.add(
      this.upstreamMessageQueue.onDidPublishMessage(message => {
        // TODO: Clarify validation procedure
        //this._validateIncomingMessage(message);
        const {header} = message;
        if (header.portalHostPeerId === header.senderPeerId) {
          const logObj = {message: message};
          log.debug('Delivering message to guest portal binding: ', logObj);
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

  replaceUpstreamMessageQueue(messageQueue) {
    this.deactivateListeners();
    this.upstreamMessageQueue = messageQueue;
    this.activateListeners();
  }

  replaceDownstreamMessageQueue(messageQueue) {
    this.deactivateListeners();
    this.downstreamMessageQueue = messageQueue;
    this.activateListeners();
  }

}
module.exports = GuestPortalBindingMessageHandler;
