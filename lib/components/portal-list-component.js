'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {CompositeDisposable} = require('atom');
const HostPortalBindingComponent = require('./host-portal-binding-component');
const GuestPortalBindingComponent = require('./guest-portal-binding-component');
const JoinPortalComponent = require('./join-portal-component');
const config = require('./../config.js');
const log = require('loglevel').getLogger('portal-list-component');
log.setLevel(config.logLevels.views);

/**
 * View class to display the list of portals hosted by this peer and the list of
 * portals to which this peer is connected.
 */
class PortalListComponent {

  /**
   * Expected parameters
   * @param statusBar
   * @param portalBindingManager
   * @param commandRegistry
   * @param clipboard
   * @param workspace
   * @param notificationManager
   * @param hostPortalBinding
   * @param guestPortalBindings
   */
  constructor(props) {
    // Defensive copying
    this.props = Object.assign({}, props);
    this.props.initialising = true;
    this.subscriptions = new CompositeDisposable();
    etch.initialize(this);

    this.subscriptions.add(
      this.props.portalBindingManager.onPortalsStatusChange(async () => {
        await this._fetchModel();
        etch.update(this);
      })
    );

    // The asynchronous computation `await this.initialisationPromise()` will
    // only complete once the the `resolve` function in the `Promise` below is
    // called. So, by assigning to `resolve` the identifier
    // `resolveInitialisationPromise` - which is in the global scope of the
    // class - we can simply call `resolveInitialisationPromise()` to signal
    // when our initialisation work is done. Thus, any functions waiting on
    // `this.initialisationPromise()` to complete will be blocked until the
    // `resolveInitialisationPromise()` call has been made.
    let resolveInitialisationPromise;
    this.initialisationPromise = new Promise((resolve) => {
      resolveInitialisationPromise = resolve;
    });
    this._fetchModel().then(async () => {
      // We've fetched the model, so our initialisation work is done. Now, just
      // update the view and signal that initialisation all work is done.
      this.props.initialising = false;
      await etch.update(this);
      resolveInitialisationPromise();
    });
  }

  async _fetchModel() {
    const {portalBindingManager} = this.props;
    this.props.hostPortalBinding =
      await portalBindingManager.getHostPortalBinding();
    this.props.guestPortalBindings =
      await portalBindingManager.getGuestPortalBindings();
  }

  /**
   * Destroy this view class
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
    await this._fetchModel();
    return etch.update(this);
  }

  /**
   * Visually render this component.
   */
  render() {
    if (this.props.initialising) {
      return (
        <div
         className="PortalListComponent--initializing"
         ref="initialisationSpinner"
        >
          <span className="loading loading-spinner-tiny inline-block"/>
        </div>
      );
    } else {
      return (
        <div className="PortalListComponent">
          {this._renderHostPortalBindingComponent()}
          {this._renderGuestPortalBindingComponents()}
          {this._renderJoinPortalComponent()}
        </div>
      );
    }
  }

  /**
   * Render a view of the host portal binding
   */
  _renderHostPortalBindingComponent() {
    return $(HostPortalBindingComponent, {
      ref: 'hostPortalBindingComponent',
      clipboard: this.props.clipboard,
      portalBindingManager: this.props.portalBindingManager,
      portalBinding: this.props.hostPortalBinding
    });
  }

  /**
   * Render a view of all guest portal bindings
   */
  _renderGuestPortalBindingComponents() {
    if (!this.props.guestPortalBindings ||
        this.props.guestPortalBindings.size === 0) {
      return null;
    }

    const portalBindingComponents = this.props.guestPortalBindings.forEach(
      (portalBinding) => {
        $(GuestPortalBindingComponent, {portalBinding})
      }
    );

    return (
      <div ref="guestPortalBindingsContainer"
           className="PortalListComponent-GuestPortalsContainer">
        {portalBindingComponents}
      </div>
    );
  }

  /**
   * Render a view that conveys live information about state changes when this
   * peer is attempting to join a portal.
   */
  _renderJoinPortalComponent() {
    return $(JoinPortalComponent, {
      ref: 'joinPortalComponent',
      portalBindingManager: this.props.portalBindingManager,
      commandRegistry: this.props.commandRegistry,
      clipboard: this.props.clipboard,
      notificationManager: this.props.notificationManager
    });
  }

  /**
   * Render a show a prompt that asks a user to join a portal
   */
  async showJoinPortalPrompt() {
    await this.initialisationPromise;
    await this.refs.joinPortalComponent.showPrompt();
  }
}

module.exports = PortalListComponent;
