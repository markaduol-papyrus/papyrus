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
    log.debug('Constructing JoinPortalComponent: ', props);

    // Defensive copying
    this.props = Object.assign({}, props);
    this.subscriptions = new CompositeDisposable();

    // Register commands that can be invoked on this element and wrap in
    // them in a disposable
    this.subscriptions = this.props.commandRegistry.add(this.element, {
      'core:confirm': this._joinPortal.bind(this),
      'core:cancel': this._hidePrompt.bind(this)
    });
    etch.initialize(this);
  }

  destroy() {
    log.debug('Destroying JoinPortalComponent.');

    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update(props) {
    log.debug('Updating JoinPortalComponent: ', props);

    Object.assign(this.props, props);
    return etch.update(this);
  }

  render() {
    log.debug('Rendering JoinPortalComponent');

    const {joiningPortal, promptVisible} = this.props;
    if (joiningPortal) {
      return (
        <div className="JoinPortalComponent--no-prompt">
          <span
           ref="joiningSpinner"
           className="loading loading-spinner-tiny inline-block"
          />
        </div>
      );
    } else if (promptVisible) {
      return (
        <div className="JoinPortalComponent--prompt" tabIndex={-1}>
          <TextEditor
           ref="portalIdEditor"
           mini={true}
           placeholderText={'Enter a portal URL...'}
          />
          <button
           ref="joinButton"
           type="button"
           disabled={true}
           className="btn btn-xs"
           onClick={this._joinPortal}
          >
          Join
          </button>
        </div>
      );
    } else {
      return (
        <div className="JoinPortalComponent--no-prompt">
          <label ref="joinPortalLabel" onClick={this._showPrompt}>
            Join a portal
          </label>
        </div>
      );
    }
  }

  async _showPrompt() {
    log.debug('Showing propmpt.');

    // Render the prompt with the text field and button
    await this.update({promptVisible: true});

    // Try and automatically load any copied text into the mini text editor
    let clipboardText = this.props.clipboard.read();
    if (clipboardText) clipboardText = clipboardText.trim();
    if (findPortalId(clipboardText)) {
      this.refs.portalIdEditor.setText(clipboardText);
    }

    // Focus on the mini text editor
    this.refs.portalIdEditor.element.focus();
  }

  async _hidePrompt() {
    log.debug('Hiding prompt.');

    await this.update({promptVisible: false});
  }

  async _joinPortal() {
    log.debug('Joining portal.');

    const portalId = findPortalId(this.refs.portalIdEditor.getText().trim());

    // Check that the portal ID editor actually contains a valid portal URL
    if (!portalId) {
      let info = 'This doesn\'t look like a valid portal identifier.';
      info += 'Please ask your host to provide you with their current portal';
      info += 'URL and try again.';

      this.props.notificationManager.addError('Invalid format', {
        description: info,
        dismissable: true
      });
      return;
    }

    // Update UI
    await this.update({joiningPortal: true});
    await manager.createAndInitialiseGuestPortalBinding();
    manager.onJoinedGuestPortal((event) => {
      const {portalHostPeerId} = event;
      await this.update({joinPortal: false});
    });
  }

}

module.exports = JoinPortalComponent;
