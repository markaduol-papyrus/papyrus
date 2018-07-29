'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {TextEditor, CompositeDisposable} = require('atom');

class JoinPortalComponent {
  /**
   * @param {String} ref - A reference to the DOM element
   * @param {Object} portalBindingManager - Portal binding manager
   * @param {Object} commandRegistry - Command registry
   * @param {Object} clipboard - Clipboard
   * @param {Object} notificationManager - Notification manager
   */
  constructor(props) {
    // Defensive copying
    this.props = Object.assign({}, props);
    
    this.subscriptions = new CompositeDisposable();

    // Must be called last
    etch.initialize(this);
  }

  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update(props) {
    Object.assign(this.props, props);
    return etch.update(this);
  }

  render() {
    return <div>Join Portal Component</div>
  }

}

module.exports = JoinPortalComponent;
