'use babel';
/** @jsx etch.dom */

const {CompositeDisposable} = require('atom');

class GuestPortalBindingComponent {
  /**
   * @param {Object} portalBinding - A reference to a portal binding object
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
    if (props.portalBinding !== this.props.portalBinding) {
      // Subscribe to changes from new portal binding instead
      // this._subscribeToPortalBindingChanges(props.portalBinding);
    }
    Object.assign(this.props, props);
    return etch.update(this);
  }

  /*_subscribeToPortalBindingChanges(portalBinding) {
    this.subscriptions.dispose();
    if (portalBinding) {
      this.subscriptions.add(
        portalBinding.onPeerJoined(() => etch.update(this))
      );
      this.subscriptions.add(
        portalBinding.onPeerL
      )
    }
  }*/

  render() {
    <div>Guest Portal Stub</div>
  }
}

module.exports = GuestPortalBindingComponent;
