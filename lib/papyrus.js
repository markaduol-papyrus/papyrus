'use babel';

import PapyrusView from './papyrus-view';
import { CompositeDisposable } from 'atom';
import TextBufferProxy from './client/text-buffer-proxy.js';
import Controller from './client/controller.js';

function log(message) {
  console.log('PAPYRUS: ' + message);
}

class Papyrus {
  constructor(options) {
    this.subscriptions = new CompositeDisposable();
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

    this.subscriptions.add(atom.commands.add('atom-workspace.papyrus-Host', {
      'papyrus:copy-portal-url': () => this.copyHostPortalURI()
    }));

    /*
    // Create a CompositeDisposable to hold our subscription to the active text
    // editor
    this.activeEditorSubscriptions = new CompositeDisposable();

    // Special variables
    this.textBufferURIs;
    this.controller;
    this.textBufferProxies = new Map();

    // Create Peer connection layer
    log('Creating PeerConnectionLayer...');
    this.peerConnectionLayer = new PeerConnectionLayer();
    log('Firing up PeerConnectionLayer...');
    await this.peerConnectionLayer.fireUp();
    log('Successfully fired up PeerConnectionLayer');
    */
    // Asynchronous sign-in
    this.signInUsingSavedToken();
  },

  deactivate() {
    this.subscriptions.dispose();

    if (this.portalStatusBarIndicator) this.portalStatusBarIndicator.destroy();
  }

  /** ACTIONS ON PORTAL */

  /**
   * Create and share a portal
   */
  async sharePortal() {
    this.showPopover();

    if (await this.isSignedIn()) {
      const manager = await this.getPortalBindingManager();
      const portalBinding = await manager.createHostPortalBinding();
      if (portalBinding) return portalBinding;
    }
  }

  /**
   * Join the portal with the given ID
   */
  async joinPortal(id) {
    this.showPopover();

    if (await this.isSignedIn()) {
      if (id) {
        const manager = await this.getPortalBindingManager();
        const portalBinding = await manager.createGuestPortalBinding(id);
        if (portalBinding) return portalBinding;
      } else {
        await this.showJoinPortalPrompt();
      }
    }

  }

  /**
   * If this is a host portal, close it
   */
  async closeHostPortal() {
    this.showPopover();

    const manager = await this.getPortalBindingManager();
    const hostPortalBinding = await manager.getHostPortalBinding();
    hostPortalBinding.close();
  }

  /**
   * Copy the URI of the host portal
   */
  async copyHostPortalURI() {
    const manager = await this.getPortalBindingManager();
    const hostPortalBinding = await manager.getHostPortalBinding();
    atom.clipboard.write(hostPortalBinding.uri);
  }

  /**
   * Leave the portal
   */
  async leavePortal() {
    this.showPopover();

    const manager = await this.getPortalBindingManager();
    const guestPortalBinding = await manager.getActiveGuestPortalBinding();
    guestPortalBinding.leave();
  }

  /** MISCELLANOUS */

  /**
   * Show a pop-up that asks the user to join a portal
   */
  async showJoinPortalPrompt() {
    if (!this.portalStatusBarIndicator) return;

    const {popoverComponent} = this.portalStatusBarIndicator;
    const {portalListComponent} = popoverComponent.refs;
    await portalListComponent.showJoinPortalPrompt();
  }

  showPopover() {
    // If the DOM element for the status bar indicator does not exist, we
    // cannot show it.
    if (!this.portalStatusBarIndicator) return;
    this.portalStatusBarIndicator.showPopover();
  }

  getPortalBindingManager() {
    if (!this.portalBindingManagerPromise) {
      // Create a new portal binding manager
      this.portalBindingManagerPromise = new Promise(async (resolve) => {
        const peerConnectionLayer = await this.getPeerConnectionLayer();
        if (peerConnectionLayer) {
          resolve(new PortalBindingManager({
            peerConnectionLayer,
            workspace: this.workspace,
            notificationManager: this.notificationManager
          }));
        } else {
          this.portalBindingManagerPromise = null;
          resolve(null);
        }
      });
    }

    return this.portalBindingManagerPromise;
  }

  async isSignedIn() {

  }

  async signOut() {

  }

  async signInUsingSavedToken() {

  }

  getPeerConnectionLayer() {
    if (this.peerConnectionLayer) return this.peerConnectionLayer;
    try {
      await this.peerConnectionLayer.initialise();
      return this.peerConnectionLayer;
    } catch (error) {

    }
  }

  /**
   * Join a portal hosted by the peer with the given ID
   */
  async joinPortal(portalHostPeerId) {
    this.controller = new Controller();
    await this.controller.fireUp();

    log('Registering Controller as an observer of PeerConnectionLayer');
    this.peerConnectionLayer.registerObserver(this.controller);
    // Attach peer connection layer to controller so that controller can command
    // it
    this.controller.addPeerConnectionLayer(this.peerConnectionLayer);
    this.controller.connectToPortal(portalHostPeerId);
  }

  /**
   * Procedure used by portal host to destroy portal
   */
  destroyPortal() {
    console.log('Don\'t know how to destroy portal yet...');
    this.activeEditorSubscriptions.dispose();
    // Lose the reference to the Controller
    if (this.controller) this.controller.tearDown();
    this.textBufferProxies.forEach(textBufferProxy => {
      textBufferProxy.tearDown();
    });
  }
};
