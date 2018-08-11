'use babel';
/** @jsx etch.dom */

const {CompositeDisposable} = require('atom');
const etch = require('etch');
const $ = etch.dom;
const ParticipantsComponent = require('./participants-component.js');
const config = require('./../../config.js')
const log = require('loglevel').getLogger('host-portal-binding-component');
log.setLevel(config.logLevels.views);

class HostPortalBindingComponent {
  /**
   * @param {string} ref - Reference that can be used by external modules to
   * access the DOM element of this component. This reference will have been
   * determined by the parent component that constructed "this"
   * HostPortalBindingComponent
   * @param {Object} clipboard - Clipboard reference
   * @param {Object} portalBindingManager - PortalBindingManager reference
   * @param {Object} portalBinding - Potentially null portal-binding reference
   */
  constructor(props) {
    log.debug('Constructing HostPortalBindingComponent: ', props);

    // Defensive copying
    this.props = Object.assign({}, props);
    this.subscriptions = new CompositeDisposable();
    this._subscribeToPortalBindingChanges(this.props.portalBinding);
    etch.initialize(this);
  }

  destroy() {
    log.debug('Destroying HostPortalBindingComponent.');

    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update(props) {
    log.debug('Updating HostPortalBindingComponent: ', props);

    if (props.portalBinding !== this.props.portalBinding) {
      this._subscribeToPortalBindingChanges(props.portalBinding);
    }
    Object.assign(this.props, props);
    return etch.update(this);
  }

  /**
   * Subscribe to some changes of the given portal binding
   */
  _subscribeToPortalBindingChanges(portalBinding) {
    const logObj = {portalBinding: portalBinding};
    log.debug('Subscribing to portal-binding changes: ', logObj);

    this.subscriptions.dispose();
    if (portalBinding) {
      this.subscriptions.add(
        portalBinding.onAcceptedJoinPortalRequest(() => etch.update(this))
      );
      this.subscriptions.add(
        portalBinding.onAcceptedLeavePortalRequest(() => etch.update(this))
      );
    }
  }

  render() {
    log.debug('Rendering HostPortalBindingComponent.');

    return (
      <div className="HostPortalComponent">
        {this._renderConnectionInfo()}
        <div className="HostPortalComponent-status">
          <ParticipantsComponent
           portalBinding={this.props.portalBinding}
           username={this.props.portalBindingManager.getLocalUsername()}
          />
          <div className="HostPortalComponent-share-toggle">
            <label>
              Share
              <input
               ref="toggleShareCheckbox"
               className="input-toggle"
               type="checkbox"
               onClick={this._toggleShare}
               checked={this._isSharing() || this.props.creatingPortal}/>
            </label>
          </div>
        </div>
      </div>
    );
  }

  _renderConnectionInfo() {
    log.debug('Rendering connection info.');

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
             value={this.getPortalURL()}
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
    log.debug('Rendering "creating-portal" spinner.');

    let classes = 'HostPortalComponent-connection-info-spinner loading ';
    classes += 'loading-spinner-tiny'
    return <span ref="creatingPortalSpinner" className={classes}/>;
  }

  async _toggleShare() {
    log.debug('Toggling sharing of portal.');

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
    log.debug('Copying portal URL to clipboard.');

    const {clipboard} = this.props;
    // Write the portal's URL to the clipboard
    clipboard.write(this.getPortalURL());

    // Reset the timeout till the portal URL is wiped from the clipboard
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
    log.debug('Checking whether portal is being shared.');

    return this.props.portalBinding !== undefined &&
           this.props.portalBinding !== null;
  }

  getPortalURL() {
    log.debug('Retrieving portal URL');

    if (this.portalURLPollingFunction) {
      // Stop polling
      clearInterval(this.portalURLPollingFunction);
    }

    if (this.props.portalBinding && this.props.portalURL) {
      return this.props.portalURL;
    }

    // Polling until we get a valid non-null URL
    this.portalURLPollingFunction = setInterval(() => {
      if (this.props.portalBinding) {
        this.props.portalURL = this.props.portalBinding.getLocalPeerId();
        etch.update(this);
      }
    }, 1000);
  }
}

module.exports = HostPortalBindingComponent;
