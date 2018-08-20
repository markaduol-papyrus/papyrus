'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {CompositeDisposable} = require('atom');
const ParticipantsComponent = require('./participants-component');
const config = require('./../config.js')
const log = require('loglevel').getLogger('guest-portal-binding-component');
log.setLevel(config.logLevels.views);

class GuestPortalBindingComponent {
  
  /**
   * @param {string} portalHostPeerId
   * @param {GuestPortalBinding} portalBinding
   * @param {PortalStore} portalStore
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
        {this.props.portalStore.getLocalUsername()}
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
    this.props.portalStore.closeGuestPortalBinding(this.props.portalHostPeerId);
  }
}

module.exports = GuestPortalBindingComponent;
