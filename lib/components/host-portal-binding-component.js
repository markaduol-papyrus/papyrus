'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const {CompositeDisposable} = require('atom');
const ParticipantsComponent = require('./participants-component.js');

class HostPortalBindingComponent {
  /**
   * @param {string} ref - Reference that can be used by external modules to
   * access the DOM element of this component
   * @param {Object} clipboard - Clipboard reference
   * @param {Object} portalBindingManager - PortalBindingManager reference
   * @param {Object} portalBinding - Non-null portal-binding reference
   */
  constructor(props) {
    // Defensive copying
    this.props = Object.assign({}, props);

    // Should only be used to subscribe to changes from a single portal binding
    this.subscriptions = new CompositeDisposable();

    etch.initialize(this);
    this._subscribeToPortalBindingChanges(props.portalBinding);
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
           username={this.props.portalBindingManager.getUsername()}
          />
          <div className="HostPortalComponent-share-toggle">
            <label>
              Share
              <input
               ref="toggleShareCheckbox"
               className="input-toggle"
               type="checkbox"
               checked={this._isSharing() || this.props.creatingPortal}/>
            </label>
          </div>
        </div>
      </div>
    );
  }

  _renderConnectionInfo() {
    const {creatingPortal, showCopiedInformation} = this.props;
    const statusClassName = creatingPortal ? 'creating-portal' : '';

    if (creatingPortal || this._isSharing()) {
      const copyButtonText = showCopiedInformation ? 'Copied' : 'Copy';

      return (
        <div className="HostPortalComponent-connection-info">
          {creatingPortal ? this._renderCreatingPortalSpinner() : null}
          <div
           className={
             'HostPortalComponent-connection-info-heading ' + statusClassName
           }>
            <h1>Invite collaborators to join your portal with this URL</h1>
          </div>
          <div className={
            'HostPortalComponent-connection-info-portal-url ' + statusClassName
          }>
            <input
             className="input-text host-id-input"
             type="text"
             disabled={true}
             value={this.getPortalURI()}
            />
            <button
             className="btn btn-xs"
             onClick={this._copyPortalURLToClipboard}>
             {copyButtonText}
            </button>
          </div>
        </div>
      );
    } else {
      return null;
    }
  }

  _renderCreatingPortalSpinner() {
    let classes = 'HostPortalComponent-connection-info-spinner loading ';
    classes += 'loading-spinner-tiny'
    return <span ref="creatingPortalSpinner" className={classes}/>;
  }

  async _toggleShare() {
    return;
    if (this.props.portalBinding) {
      this.props.portalBinding.close();
    } else {
      // Update the UI using the new model state ("props")
      await this.update({creatingPortal: true});
      this.props.portalBinding =
        await this.props.portalBindingManager.createHostPortalBinding();
      await this.update({creatingPortal: false});
    }
  }

  _copyPortalURLToClipboard() {
    const {clipboard} = this.props;
    // Write the portal's URI to the clipboard
    clipboard.write(this.getPortalURI());

    // Reset the timeout till the portal URI is wiped from the clipboard
    if (this.copiedConfirmationResetTimeoutId) {
      clearTimeout(this.copiedConfirmationResetTimeoutId)
    }

    this.props.showCopiedInformation = true;
    etch.update(this);

    this.copiedConfirmationResetTimeoutId = setTimeout(() => {
      this.props.showCopiedInformation = false;
      etch.update(this);
      this.copiedConfirmationResetTimeoutId = null;
    }, 2000);
  }

  _isSharing() {
    return this.props.portalBinding !== undefined &&
           this.props.portalBinding !== null;
  }

  getPortalURI() {
    if (this.props.portalBinding) {
      // TODO: Construct schema for real URI
      return this.props.portalBinding.getPeerId();
    }
  }
}

module.exports = HostPortalBindingComponent;
