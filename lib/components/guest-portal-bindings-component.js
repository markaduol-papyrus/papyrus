'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const { CompositeDisposable } = require('atom');
const config = require('./../config.js');
const log = require('loglevel').getLogger('guest-portal-bindings-component');

// Setup logging
log.setLevel(config.logLevels.views);

/**
 * View class to render all remote portals to which the local peer is connected.
 */
class GuestPortalBindingsComponent {

  /**
   * Expected parameters
   * @param {PortalStore} portalStore
   */
  constructor(props) {
    log.debug('Constructing GuestPortalBindingComponent: ', props);

    this.props = Object.assign({}, props);
    this.subscriptions = new CompositeDisposable();
    etch.initialize(this);

    // Setup subscriptions
    this.subscriptions.add(
      this.props.portalStore.onJoinedRemotePortal(async () => {
        await this._fetchGuestPortalBindings();
        return etch.update(this);
      })
    );

    this.subscriptions.add(
      this.props.portalStore.onLeftRemotePortal(async () => {
        await this._fetchGuestPortalBindings();
        return etch.update(this);
      })
    );
  }

  /**
   * Fetch all guest portal bindings from the portal store
   */
  async _fetchGuestPortalBindings() {
    const {portalStore} = this.props;
    this.props.guestPortalBindings = portalStore.getGuestPortalBindings();
  }

  /**
   * Destroy the component.
   */
  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  /**
   * Update the component with the new properties.
   */
  async update(props) {
    Object.assign(this.props, props);
    await this._fetchGuestPortalBindings();
    return etch.update(this);
  }

  /**
   * Render this component
   */
  render() {
    let remoteHostParticipants = [];
    let hasGuestPortalBindings = false;

    if (this.props.guestPortalBindings &&
        this.props.guestPortalBindings.size > 0)
    {
      hasGuestPortalBindings = true;
      this.props.guestPortalBindings.forEach((portalBinding) => {
        const remoteHostUsername = portalBinding.getPortalHostUsername();
        const remoteHostPeerId = portalBinding.getPortalHostPeerId();
        const remoteHostParticipant =
          this._renderRemotePortalHost(remoteHostUsername, remoteHostPeerId);
        remoteHostParticipants.push(remoteHostParticipant);
      });
    }

    return (
      <div className="PortalListComponent-GuestPortalsContainer">
        {hasGuestPortalBindings ? remoteHostParticipants : null}
      </div>
    );
  }

  _renderRemotePortalHost(remoteHostUsername, remoteHostPeerId) {
    return (
      <div className="GuestPortalComponent">
        {remoteHostUsername}
        <button
         className="btn btn-xs GuestPortalComponent-leave"
         onClick={(remoteHostPeerId) => this._leavePortal(remoteHostPeerId)}
        >
        Leave
        </button>
      </div>
    );
  }

  _leavePortal(portalHostPeerId) {
    this.props.portalStore.closeGuestPortalBinding(portalHostPeerId);
  }
}

module.exports = GuestPortalBindingsComponent;
