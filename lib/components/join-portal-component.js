'use babel';
/** @jsx etch.dom */

const {TextEditor, CompositeDisposable} = require('atom');
const etch = require('etch');
const $ = etch.dom;
const {findPortalId} = require('./../utils/portal-id-helpers.js');
const config = require('./../config.js')
const log = require('loglevel').getLogger('join-portal-component');
log.setLevel(config.logLevels.views);


class JoinPortalComponent {
  /**
   * @param {String} ref - A reference to the DOM element created by "this"
   * components parent component
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
    etch.initialize(this);

    // Register commands that can be invoked on this element and wrap in
    // them in a disposable
    this.subscriptions.add(this.props.commandRegistry.add(this.element, {
      'core:confirm': this._joinPortal.bind(this)
    }));
    this.subscriptions.add(this.props.commandRegistry.add(this.element, {
      'core:cancel': this._hidePrompt.bind(this)
    }));
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

  // We only begin listening to the changes in the editor component box, once
  // it's been rendered for a second time. This is because, there's a glitch to
  // do with the editor component using stale font components when rendered
  // for the first time.
  readAfterUpdate() {
    const previousPortalIdEditor = this.portalIdEditor;
    this.portalIdEditor = this.refs.portalIdEditor;
    if (!this.previousPortalIdEditor && this.portalIdEditor) {
      this.portalIdEditor.onDidChange(() => {
        const portalId = this.refs.portalIdEditor.getText().trim();
        this.refs.joinButton.disabled = !findPortalId(portalId);
      });
    }
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
          <label ref="joinPortalLabel" onClick={this.showPrompt}>
            Join a portal
          </label>
        </div>
      );
    }
  }

  async showPrompt() {
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

    const manager = this.props.portalBindingManager;

    // Update UI
    await this.update({joiningPortal: true});
    manager.createAndInitialiseGuestPortalBinding(portalId);
    manager.onJoinedGuestPortal(async (event) => {
      const {portalHostPeerId} = event;
      await this.update({joiningPortal: false});
    });
  }
}

module.exports = JoinPortalComponent;
