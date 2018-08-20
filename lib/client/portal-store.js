'use babel';

const { Emitter } = require('atom');
const PortalBindingFactory = require('./portal-binding-factory.js');
const log = require('loglevel').getLogger('portal-store');
const config = require('./../config.js');
const { createRandomUsername } = require('./portal-helpers.js');

// Logging setup
log.setLevel(config.logLevels.models);

class PortalStore {

  /**
   * Expected parameters
   * @param {Object} workspace Atom workspace
   * @param {Object} notificationManager Atom notification manager
   * @param {PortalBindingFactory} portalBindingFactory Class used to create
   * portal bindings
   */
  constructor(props) {
    this.workspace = props.workspace;
    this.notificationManager = props.notificationManager;
    this.portalBindingFactory = props.portalBindingFactory;
    this.hostPortalBinding;
    this.username;
    this.guestPortalBindings = new Map();
    this.emitter = new Emitter();
    this.localPeerId;
  }

  createAndSubscribeToHostPortalBinding() {
    if (this.hostPortalBinding) {
      const logObj = {hostPortalBinding: this.hostPortalBinding};
      const info = 'Creating host portal binding when one already exists: ';
      log.warn(info, logObj);
    }

    this.username = createRandomUsername();
    const hostPortalBindingProps = {
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      username: this.username,
    };
    this.hostPortalBinding =
      this.portalBindingFactory.createAndConnectHostPortalBinding(
        hostPortalBindingProps
      );

    this.hostPortalBinding.onDeliveredLocalPeerId((event) => {
      this.localPeerId = event.localPeerId;
    });

    this.emitter.emit('created-host-portal');
    this.emitter.emit('portals-status-change');
    return this.hostPortalBinding;
  }

  closeHostPortalBinding() {
    log.debug('Closing host portal binding.');

    if (!this.hostPortalBinding) {
      log.warn('HostPortalBinding does not exist.');
    }
    this.hostPortalBinding.deactivateListeners();
    this.emitter.emit('closed-host-portal');
    this.emitter.emit('portals-status-change');
  }

  async createAndSubscribeToGuestPortalBinding(portalHostPeerId) {

    // Check if portal binding already exists
    let portalBinding = this.guestPortalBindings.get(portalHostPeerId);
    if (portalBinding) {
      const logObj = {guestPortalBinding: portalBinding};
      const info = 'Creating guest portal binding when one already exists: ';
      log.warn(info, logObj);
    }
    if (!this.localPeerId) {
      let info = 'Local peer ID is undefined. Most likely, PortalStore has' ;
      info += 'not received local peer ID from host portal binding. Local ';
      info += 'peer ID of guest portal binding will be undefined.';
      log.warn(info);
    }

    // Create portal binding
    const guestPortalBindingProps = {
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      username: this.username,
      portalHostPeerId: portalHostPeerId,
      localPeerId: this.localPeerId,
    };
    portalBinding =
      this.portalBindingFactory.createAndConnectGuestPortalBinding(
        guestPortalBindingProps
      );

    // Send join request. Resolve the promise and emit an event only when we
    // receive acknowledgement that the portal host has accepted the request
    portalBinding.sendJoinPortalRequest();

    let resolveJoinPortalRequestAccepted;
    const hostAcceptedJoinPortalRequest = new Promise(resolve => {
      resolveJoinPortalRequestAccepted = resolve;
    });

    portalBinding.onHostAcceptedJoinPortalRequest((event) => {
      if (!event.portalHostPeerId === portalHostPeerId) {
        const logObj = JSON.stringify({
          expectedPortalHostPeerId: portalHostPeerId,
          actualPortalHostPeerId: event.portalHostPeerId,
        });
        throw new Error(`Invalid portal host peer ID: ${logObj}`);
      }
      this.guestPortalBindings.set(portalHostPeerId, portalBinding);
      this.emitter.emit('joined-remote-portal', portalHostPeerId);
      this.emitter.emit('portals-status-change');
      resolveJoinPortalRequestAccepted();
    })
    await hostAcceptedJoinPortalRequest;
    return portalBinding;
  }

  closeGuestPortalBinding(portalHostPeerId) {
    let portalBinding = this.guestPortalBindings.get(portalHostPeerId);
    if (!portalBinding) {
      const logObj = {portalHostPeerId: portalHostPeerId};
      log.warn('GuestPortalBinding for portal host does not exist: ', logObj);
    }
    portalBinding.deactivateListeners();
    this.guestPortalBindings.delete(portalHostPeerId);
    this.emitter.emit('left-remote-portal', portalHostPeerId);
    this.emitter.emit('portals-status-change');
  }

  onPortalsStatusChange(callback) {
    return this.emitter.on('portals-status-change', callback);
  }

  onCreatedHostPortal(callback) {
    return this.emitter.on('created-host-portal', callback);
  }

  onClosedHostPortal(callback) {
    return this.emitter.on('closed-host-portal', callback);
  }

  onJoinedRemotePortal(callback) {
    return this.emitter.on('joined-remote-portal', callback);
  }

  onLeftRemotePortal(callback) {
    return this.emitter.on('left-remote-portal', callback);
  }

  hasActivePortals() {
    return this.hostPortalBinding || this.guestPortalBindings.size > 0;
  }

  getHostPortalBinding() {
    return this.hostPortalBinding;
  }

  getGuestPortalBinding(portalHostPeerId) {
    const portalBinding = this.guestPortalBindings.get(portalHostPeerId);
    if (!portalBinding) {
      log.warn('No portal binding: ', {portalHostPeerId: portalHostPeerId});
    }
    return portalBinding;
  }

  getGuestPortalBindings() {
    return this.guestPortalBindings;
  }

  getLocalUsername() {
    return this.username;
  }
}
module.exports = PortalStore;
