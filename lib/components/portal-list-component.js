'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {CompositeDisposable} = require('atom');
const HostPortalBindingComponent = require('./host-portal-binding-component');
const GuestPortalBindingComponent = require('./guest-portal-binding-component');
const JoinPortalComponent = require('./join-portal-component');
const config = require('./../../config.js');
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

    this.subscriptions = new CompositeDisposable();

    etch.initialize(this);
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
    return etch.update(this);
  }

  /**
   * Visually render this component.
   */
  render() {
    return (
      <div className="PortalListComponent">
        {this._renderHostPortalBindingComponent()}
        {this._renderGuestPortalBindingComponents()}
        {this._renderJoinPortalComponent()}
      </div>
    );
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
    log.debug('Function "showJoinPortalPrompt()" not yet implemented');
  }
}

module.exports = PortalListComponent;
