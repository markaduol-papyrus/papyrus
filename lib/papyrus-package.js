'use babel';

import PapyrusView from './papyrus-view';
import { CompositeDisposable } from 'atom';
import TextBufferProxy from './client/text-buffer-proxy.js';
import PeerConnectionLayer from './client/peer-connection-layer.js';
import PortalBindingManager from './client/portal-binding-manager.js';
import PortalStatusBarIndicator from './client/portal-status-bar-indicator.js';
import config from './../config.js';
import MessageTypes from './message-types.js';
const JOIN_PORTAL = MessageTypes.JOIN_PORTAL;

///////////////////////////////// LOGGING //////////////////////////////////////
const log = require('loglevel').getLogger('papyrus-package');
log.setLevel(config.logLevels.models);

////////////////////////////////////////////////////////////////////////////////

class PapyrusPackage {
  constructor(options) {
    const {
      workspace, notificationManager, clipboard, portalBindingManager,
      tooltipManager
    } = options;
    this.papyrusView = new PapyrusView();
    this.subscriptions = new CompositeDisposable();
    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.clipboard = clipboard;
    this.portalBindingManager = portalBindingManager;
    this.tooltipManager = tooltipManager;
  }

  activate() {
    this.portalBindingManager.initialise();

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'papyrus:share-portal': () => this.sharePortal()
    }));

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'papyrus:leave-portal': () => this.leavePortal()
    }));

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'papyrus:join-portal': () => this.joinPortal()
    }));

    this.subscriptions.add(atom.commands.add('atom-workspace.papyrus-Host', {
      'papyrus:close-portal': () => this.closeHostPortal()
    }));
  }

  deactivate() {
    this.subscriptions.dispose();
  }

  /************************ CREATE/SHARE/JOIN/CLOSE ***************************/

  /**
   * Create and share a portal
   */
  async sharePortal() {
    log.debug('Sharing portal.');

    this.showPopover();
    const portalBinding =
      await this.portalBindingManager.createHostPortalBinding();
    return portalBinding;
  }

  /**
   * Join the portal with the given ID. If no ID is specified, show a prompt to
   * join the portal.
   */
  async joinPortal(portalHostPeerId) {
    log.debug('Joining portal hosted by peer: ', portalHostPeerId);

    this.showPopover();
    const manager = this.portalBindingManager;

    if (portalHostPeerId) {
      await manager.connectToPeer(portalHostPeerId);
      // Construct "join portal" message
      const msg = {
        type: JOIN_PORTAL,
        portalHostPeerId: portalHostPeerId,
        senderPeerId: manager.getPeerId()
      };
      await manager.sendMessageToPeer(msg, portalHostPeerId);
      const portalBinding = manager.createGuestPortalBinding(portalHostPeerId);
      if (portalBinding) return portalBinding;
    } else {
      this.showJoinPortalPrompt();
    }
  }

  /**
   * If this is a host portal, close it
   */
  async closeHostPortal() {
    log.debug('Closing host portal.');

    this.showPopover();
    if (this.portalBindingManager) {
      const portalBinding = this.portalBindingManager.getHostPortalBinding();
      if (portalBinding) portalBinding.close();
    }
  }

  /**
   * Leave the portal with the specified ID
   */
  async leavePortal(portalHostPeerId) {
    log.debug('Leaving portal hosted by peer: ', portalHostPeerId);

    this.showPopover();
    const portalBinding =
      await this.portalBindingManager.getGuestPortalBinding(portalHostPeerId);
    portalBinding.close();
  }

  /** MISCELLANOUS */

  /**
   * Consume the status-bar service
   */
  async consumeStatusBar(statusBar) {
    this.portalStatusBarIndicator = await new PortalStatusBarIndicator({
      statusBar: statusBar,
      portalBindingManager: this.portalBindingManager,
      commandRegistry: this.commandRegistry,
      clipboard: this.clipboard,
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      tooltipManager: this.tooltipManager,
    });
    // Attach the indicator to the status bar
    this.portalStatusBarIndicator.attach();
  }

  /**
   * Show popover component
   */
  showPopover() {
    if (!this.portalStatusBarIndicator) return;
    this.portalStatusBarIndicator.showPopover();
  }

  /**
   * Show the prompt that asks the user to join a portal
   */
  async showJoinPortalPrompt() {
    if (!this.portalStatusBarIndicator) return;
    const {popoverComponent} = this.portalStatusBarIndicator;
    const {portalListComponent} = popoverComponent.refs;
    await portalListComponent.showJoinPortalPrompt();
  }
}

module.exports = PapyrusPackage;
