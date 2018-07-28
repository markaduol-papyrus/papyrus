'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {CompositeDisposable} = require('atom');
const HostPortalBindingComponent = require('./host-portal-binding-component');
const GuestPortalBindingComponent = require('./guest-portal-binding-component');
const JoinPortalComponent = require('./join-portal-component');

///////////////////////////// ERRORS AND LOGGING ///////////////////////////////
import config from './../../config.js';

function logError(message) {
  console.error('PORTAL LIST COMPONENT: ' + message);
}

function log(message) {
  console.log('PORTAL LIST COMPONENT: ' + message);
}

function logDebug(message) {
  if (config.debug) log(message);
}
////////////////////////////////////////////////////////////////////////////////


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
   */
  constructor(props) {
    this.props = props;
    etch.initialize(this);
    this.subscriptions = new CompositeDisposable();

    // Register a callback that subscribes to changes in the portal binding
    // manager and updates the view to visually reflect these changes.
    this.subscriptions.add(
      this.props.portalBindingManager.onDidChange(async () => {
        await this._fetchNewModelState()
        etch.update(this)
      })
    );
  }

  /**
   * Destroy this view class
   */
  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  /**
   * Fetch some info about the model (i.e. portalBindingManager) to which this
   * class has subscribed, and then load this info into "this.props".
   */
  async _fetchNewModelState() {
    const {portalBindingManager} = this.props;
    this.props.hostPortalBinding =
      await portalBindingManager.getHostPortalBinding();
    this.props.guestPortalBindings =
      await portalBindingManager.getGuestPortalBindings();
  }

  /**
   * Update the component with the new properties.
   */
  async update(props) {
    Object.assign(this.props, props);
    await this._fetchNewModelState();
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
        {this._renderJoinPortalComponents()}
      </div>
    );
  }

  /**
   * Render a view of the host portal binding
   */
  async _renderHostPortalBindingComponent() {
    const portalBinding =
      await this.props.portalBindingManager.getHostPortalBinding();

    return $(HostPortalBindingComponent, {
      ref: 'hostPortalBindingComponent',
      clipboard: this.props.clipboard,
      portalBindingManager: this.props.portalBindingManager,
      portalBinding: portalBinding
    });
  }

  /**
   * Render a view of all guest portal bindings
   */
  _renderGuestPortalBindingComponents() {
    const manager = this.props.portalBindingManager;
    const guestPortalBindings = manager.getGuestPortalBindings();

    const portalBindingComponents = guestPortalBindings.forEach(
      (portalBinding) => {
        $(GuestPortalBindingComponent, {portalBinding})
      }
    );
    return $.div(
      {
        ref: 'guestPortalBindingsContainer',
        className: 'PortalListComponent-GuestPortalsContainer'
      },
      portalBindingComponents
    );
  }

  /**
   * Render a view that conveys live information about state changes when this
   * peer is attempting to join a portal.
   */
  _renderJoinPortalComponents() {
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
    logDebug('Function "showJoinPortalPrompt()" not yet implemented.');
  }
}

module.exports = PortalListComponent;
