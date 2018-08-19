'use babel';

const PapyrusView = require('./papyrus-view');
const { CompositeDisposable } = require('atom');
const TextBufferProxy = require('./client/text-buffer-proxy.js');
const ConnectionLayer = require('./client/connection-layer.js');
const config = require('./config.js');
const MessageTypes = require('./client/message-types.js');
const MessageBuilder = require('./client/message-builder.js');
const PortalStatusBarIndicator =
  require('./client/portal-status-bar-indicator.js');
const log = require('loglevel').getLogger('papyrus-package');
const MessageQueue = require('./client/message-queue.js');
const PortalBindingFactory = require('./client/portal-binding-factory.js');
const PortalStore = require('./client/portal-store.js');

// Logging setup
log.setLevel(config.logLevels.models);

////////////////////////////////////////////////////////////////////////////////

class PapyrusPackage {

  /**
   * Expected parameters
   * @param {Object} workspace
   * @param {Object} notificationManager
   * @param {Object} clipboard
   * @param {Object} tooltipManager
   * @param {Object} commandRegistry
   */
  constructor(parameters) {
    const {
      workspace, notificationManager, clipboard, tooltipManager, commandRegistry
    } = parameters;
    this.papyrusView = new PapyrusView();
    this.subscriptions = new CompositeDisposable();
    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.clipboard = clipboard;
    this.tooltipManager = tooltipManager;
    this.commandRegistry = commandRegistry;
  }

  activate() {
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'papyrus:share-portal': () => this.sharePortal()
    }));

    return new Promise((resolve, reject) => {
      try {
        this.connectionLayer = new ConnectionLayer({
          incomingMessageQueue: new MessageQueue(),
          outgoingMessageQueue: new MessageQueue(),
        });
        this.connectionLayer.connectToServer();
        this.connectionLayer.activateIncomingMessageQueueListeners();
        this.portalBindingFactory = new PortalBindingFactory({
          connectionLayer: this.connectionLayer,
        });
        this.portalStore = new PortalStore({
          workspace: this.workspace,
          notificationManager: this.notificationManager,
          portalBindingFactory: this.portalBindingFactory,
        });

        this.resolveStatusBarIndicatorPromise;
        this.statusBarIndicatorInitialised = new Promise(resolve => {
          this.resolveStatusBarIndicatorPromise = resolve;
        });

        resolve(this);
      } catch (error) {
        reject(error);
      }
    });
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

    await this.statusBarIndicatorInitialised;
    this.showPopover();
    const portalBinding =
      this.portalStore.createAndSubscribeToHostPortalBinding();
    return portalBinding;
  }

  /** MISCELLANOUS */

  /**
   * Consume the status-bar service
   */
  async consumeStatusBar(statusBar) {
    this.portalStatusBarIndicator = await new PortalStatusBarIndicator({
      statusBar: statusBar,
      portalStore: this.portalStore,
      commandRegistry: this.commandRegistry,
      clipboard: this.clipboard,
      workspace: this.workspace,
      notificationManager: this.notificationManager,
      tooltipManager: this.tooltipManager,
    });
    // Attach the indicator to the status bar
    this.portalStatusBarIndicator.attach();
    this.resolveStatusBarIndicatorPromise();
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
