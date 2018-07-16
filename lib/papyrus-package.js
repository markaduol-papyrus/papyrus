'use babel';

import PapyrusView from './papyrus-view';
import { CompositeDisposable } from 'atom';
import TextBufferProxy from './client/text-buffer-proxy.js';
import PeerConnectionLayer from './client/peer-connection-layer.js';
import PortalBindingManager from './client/portal-binding-manager.js';

///////////////////////////////// LOGGING //////////////////////////////////////
import config from './../config.js';

function log(message) {
  console.log('PAPYRUS: ' + message);
}

function logWarning(message) {
  console.warn('PAPYRUS: ' + message);
}

function logDebug(message) {
  if (config.debug) log(message);
}
////////////////////////////////////////////////////////////////////////////////

class PapyrusPackage {
  constructor(options) {
    this.subscriptions = new CompositeDisposable();
    this.workspace = options.workspace;
    this.notificationManager = options.notificationManager;
    this.clipboard = options.clipboard;
    this.portalBindingManager;
    this.peerConnectionLayer;
  }

  activate() {
    // Register commands for that do share/destroy/leave/join portals
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

  async _setupListeners() {
    this.peerConnectionLayer = await this.createPeerConnectionLayer();
    this.portalBindingManager =
      await this.createPortalBindingManager(this.peerConnectionLayer);

  }

  deactivate() {
    this.subscriptions.dispose();
  }

  /** ACTIONS ON PORTAL */

  /**
   * Create and share a portal
   */
  async sharePortal() {
    logDebug('Sharing portal...');
    const manager = await this.getOrCreatePortalBindingManager();
    const portalBinding = manager.getOrCreateHostPortalBinding();
    if (portalBinding) return portalBinding;
  }

  /**
   * Join the portal with the given ID
   */
  async joinPortal(id) {
    logDebug('Joining portal with ID: ' + id);
    if (id) {
      const manager = await this.getOrCreatePortalBindingManager();
      const portalBinding = manager.getOrCreateHostPortalBinding();
      if (portalBinding) return portalBinding;
    } else {
      //await this.showJoinPortalPrompt();
    }
  }

  /**
   * If this is a host portal, close it
   */
  async closeHostPortal() {
    logDebug('Closing host portal...');
    if (this.portalBindingManager) {
      const portalBinding = this.getHostPortalBinding();
      if (portalBinding) portalBinding.close();
    }
    logDebug('Host portal closed.')
  }

  /**
   * Leave the portal
   */
  async leavePortal() {
  }

  /** MISCELLANOUS */

  /**
   * Create a portal binding manager
   */
  async getOrCreatePortalBindingManager() {
    if (this.portalBindingManager) return this.portalBindingManager;
    const peerConnectionLayer = await this.getOrCreatePeerConnectionLayer();

    this.portalBindingManager = new PortalBindingManager({
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      peerConnectionLayer: peerConnectionLayer
    });

    // Tell portal binding manager to listen to messages from peer conn. layer
    await peerConnectionLayer.onDidEmitMessage(
      this.portalBindingManager.handlePeerConnLayerMessage.bind(this)
    );

    await this.portalBindingManager.initialise();
    return this.portalBindingManager;
  }

  async isSignedIn() {

  }

  async signOut() {

  }

  async signInUsingSavedToken() {

  }

  /**
   * Create a peer connection layer
   */
  async getOrCreatePeerConnectionLayer() {
    if (this.peerConnectionLayer) return this.peerConnectionLayer;
    this.peerConnectionLayer = new PeerConnectionLayer();
    await this.peerConnectionLayer.initialise();
    return this.peerConnectionLayer;
  }
}

module.exports = PapyrusPackage;
