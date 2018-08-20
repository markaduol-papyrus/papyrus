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
   * @param portalStore
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
  }

  /**
   * Re-render the view.
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
      portalStore, clipboard, commandRegistry, notificationManager,
      hostPortalBinding, guestPortalBindings, workspace,
    } = this.props;

    let activeComponent = $(PortalListComponent, {
      ref: 'portalListComponent',
      workspace,
      portalStore,
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
