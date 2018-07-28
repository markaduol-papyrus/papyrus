'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const PortalListComponent = require('./portal-list-component.js');

class PopoverComponent {
  
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
    this.props = props
    etch.initialize(this);
    // For now, this component subscribes to no models and so, is simply static
    // (i.e. its rendered view never changes).
  }

  /**
   * Update the rendered view. This should be called upon model changes.
   */
  update() {
    return etch.update(this);
  }

  /**
   * Render the view
   */
  render() {
    const {
      portalBindingManager, clipboard, commandRegistry, notificationManager
    } = this.props;

    let activeComponent = $(PortalListComponent, {
      ref: 'portalListComponent',
      portalBindingManager,
      clipboard,
      commandRegistry,
      notificationManager
    });
    return <div className="PapyrusPopoverComponent">{activeComponent}</div>;
  }
}

module.exports = PopoverComponent;
