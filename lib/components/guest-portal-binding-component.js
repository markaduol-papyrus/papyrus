'use babel';
/** @jsx etch.dom */

const {CompositeDisposable} = require('atom');
const ParticipantsComponent = require('./participants-component');

class GuestPortalBindingComponent {
  /**
   * @param {Object} portalBinding A reference to a portal binding object
   * @param {String} username Username of the local peer
   */
  constructor(props) {
    log.debug('Constructing GuestPortalBindingComponent: ', props);

    // Defensive copying
    this.props = Object.assign({}, props);
    this.subscriptions = new CompositeDisposable();
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

  render() {
    return (
      <div className="GuestPortalComponent">
        <ParticipantsComponent
         portalBinding={this.props.portalBinding}
         username={this.props.username}
        />
        <button
         className="btn btn-xs GuestPortalComponent-leave"
         onClick={this._leavePortal}
        >
        Leave
        </button>
      </div>
    );
  }

  _leavePortal() {
    this.props.portalBinding.close();
  }
}

module.exports = GuestPortalBindingComponent;
