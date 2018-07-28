'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {CompositeDisposable} = require('atom');

class HostPortalBindingComponent {
  constructor(props) {
    this.props = props;
    // Should only be used to subscribe to changes from a single portal binding
    this.subscriptions = new CompositeDisposable();
  }

  destroy() {
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update(props) {
    if (props.portalBinding !== this.props.portalBinding) {
      // Subscribe to changes from new portal binding instead
      this._subscribeToPortalBindingChanges(props.portalBinding);
    }
    Object.assign(this.props, props);
    return etch.update(this);
  }

  /**
   * Subscribe to some changes of the given portal binding
   */
  _subscribeToPortalBindingChanges(portalBinding) {
    this.subscriptions.dispose();
    if (portalBinding) {
      this.subscriptions.add(
        portalBinding.onPeerJoined(() => etch.update(this))
      );
      this.subscriptions.add(
        portalBinding.onPeerLeft(() => etch.update(this))
      );
    }
  }

  render() {
    return (
      <div className="HostPortalComponent">
        {this._renderConnectionInfo()}
        <div className="HostPortalComponent-status">
          <ParticipantsComponent
           portalBinding={this.props.portalBinding}
          />
          <div className="HostPortalComponent-share-toggle">
            <label>
              <input
               ref="toggleShareCheckbox"
               className="input-toggle"
               type="checkbox"
               onClick={this._toggleShare()}
               checked={this._isSharing() || this.props.creatingPortal}/>
            </label>
          </div>
        </div>
      </div>
    );
  }

  _renderConnectionInfo() {
    return null;
  }

  _toggleShare() {
    return null;
  }

  _isSharing() {
    return this.props.portalBinding !== undefined &&
           this.props.portalBinding !== null;
  }
}

module.exports = HostPortalBindingComponent;
