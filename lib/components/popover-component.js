'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const PortalListComponent = require('./portal-list-component.js');
const log = require('loglevel').getLogger('popover-component');
const config = require('./../config.js');
log.setLevel(config.logLevels.views);

class PopoverComponent {

  /**
   * Expected parameters
   * @param statusBar
   * @param portalBindingManager
   * @param commandRegistry
   * @param clipboard
   * @param workspace
   * @param notificationManager
   * @param tooltipManager
   */
  constructor(props) {
    // Defensive copying
    this.props = Object.assign({}, props);

    etch.initialize(this);

    this.props.portalBindingManager.onCreatedHostPortal(async (event) => {
      log.debug('Created host portal');
      log.debug('Event: ', event);

      this.props.hostPortalBinding = event.hostPortalBinding;
      log.debug('Props: ', this.props);

      return etch.update(this);
    });

    this.props.portalBindingManager.onClosedHostPortal(async (event) => {
      log.debug('Closed host portal');
      log.debug('Event: ', event);

      this.props.hostPortalBinding = null;
      log.debug('Props: ', this.props);

      return etch.update(this);
    });

    this.props.portalBindingManager.onJoinedGuestPortal(async (event) => {
      log.debug('Joined guest portal');

      const id = event.portalHostPeerId;
      const portal = event.guestPortalBinding;
      if (!this.props.guestPortalBindings) {
        this.props.guestPortalBindings = new Map();
      }
      this.props.guestPortalBindings.set(id, portal);
      log.debug('Props: ', this.props);
      return etch.update(this);
    });

    this.props.portalBindingManager.onLeftGuestPortal(async (event) => {
      log.debug('Left guest portal');

      this.props.guestPortalBindings.delete(event.portalHostPeerId);
      log.debug('Props: ', this.props);
      return etch.update(this);
    });
  }

  /**
   * Update the rendered view. This should be called upon model changes.
   */
  update(props) {
    Object.assign(this.props, props);
    return etch.update(this);
  }

  /**
   * Render the view
   */
  render() {
    const {
      portalBindingManager, clipboard, commandRegistry, notificationManager,
      hostPortalBinding, guestPortalBindings
    } = this.props;

    let activeComponent = $(PortalListComponent, {
      ref: 'portalListComponent',
      portalBindingManager,
      clipboard,
      commandRegistry,
      notificationManager,
      hostPortalBinding,
      guestPortalBindings
    });
    return <div className="PapyrusPopoverComponent">{activeComponent}</div>;
  }
}

module.exports = PopoverComponent;
