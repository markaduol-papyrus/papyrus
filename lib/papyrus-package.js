class PapyrusPackage {
  constructor(options) {

  }

  activate() {
    this.subscriptions.add(this.commandRegistry.add('atom-workspace', {
      'papyrus:share-portal': () => this.sharePortal()
    }));
    this.subscriptions.add(this.commandRegistry.add('atom-workspace', {
      'papyrus:join-portal': () => this.joinPortal()
    }));
    this.subscriptions.add(this.commandRegistry.add('papyrus-RemotePaneItem', {

    }));
    this.subscriptions.add(
      this.commandRegistry.add('atom-workspace.papyrus-Host', {
        'papyrus:copy-portal-uri': () => this.copyHostPortalURI()
      })
    );
    this.subscriptions.add(
      this.commandRegistry.add('atom-workspace.papyrus-Host', {
        'papyrus:close-portal': () => this.closeHostPortal()
      })
    );
  }

  async deactivate() {
    this.initializationError = null;

    this.subscriptions.dispose();
    this.subscriptions = new CompositeDisposable();

    if (this.portalStatusBarIndicator) this.portalStatusBarIndicator.destroy();

    if (this.portalBindingManagerPromise) {
      const manager = await this.portalBindingManagerPromise;
      await manager.dispose();
    }
  }

  async handleURI(parsedURI, rawURI) {

  }

  async sharePortal() {
    this.showPopover();
  }

  async joinPortal(id) {
    this.showPopover();
  }

  async closeHostPortal() {
    this.showPopover();
  }

  async copyHostPortalURI() {

  }

  async leavePortal() {

  }

  providePapyrus() {

  }

  async consumeStatusBar(statusBar) {

  }

  registerRemoteEditorOpener() {

  }

  async getRemoteEditorForURI() {

  }

  async signInUsingSavedToken() {

  }

  async signOut() {

  }

  async isSignedIn() {

  }


}
