const {CompositeDisposable, Emitter} = require('atom');
const TextBufferProxy = require('./text-buffer-proxy.js');

class HostPortalBinding {
  constructor({workspace, notificationManager}) {
    this.workspace = workspace;
    this.notificationManager = notificationManager;
    this.editorProxiesById = new WeakMap();
    this.bufferProxiesById = new WeakMap();
    this.bufferURIs = new Set();
    this.disposables = new CompositeDisposable();
  }

  /*********************** INITIALISATION AND LISTENERS ***********************/

  /**
   * Initialise the host portal
   */
  initialise() {
    this.disposables.add(
      this.workspace.observeActiveTextEditor(async editor => {
        let textBuffer = editor.getBuffer();
        let uri = textBuffer.getUri();

        if (!this.bufferURIs.has(uri)) {
          this.bufferURIs.add(uri);
          let bufferProxy = new TextBufferProxy(textBuffer);
          await bufferProxy.initialise();
          this._addTextBufferProxy(bufferProxy);
        }
      })
    );
  }

  /**
   * Called by an external module to tell the host portal which (lower-level)
   * portal binding manager to listen to.
   */
  listenToPortalBindingManager(portalBindingManager) {
    portalBindingManager.onDidEmitMessage(this._handleRemoteMessage.bind(this));
  }

  _handleRemoteMessage(msg) {
    if (msg.type === DATA_CHANNEL_MESSAGE) {

      const {data} = msg;
      this._handleDeliveredMessage(data);

    } else if (msg.type === LOCAL_PEER_ID) {

      const {localPeerId} = msg;
      this.localPeerId = localPeerId;
      this.notificationManager.addSuccess('Local Peer ID: ' + localPeerId);

    } else {
      logError(`Unknown remote message type: ${msg.type}`);
    }
  }

  /**
   * Add a text buffer proxy
   */
  _addTextBufferProxy(textBufferProxy) {
    const id = textBufferProxy.getId();
    this.bufferProxiesById.set(id, textBufferProxy);
  }

  /**
   * Add a text editor proxy
   */
  _addTextEditorProxy(textEditorProxy) {
    const id = textEditorProxy.getId();
    this.editorProxiesById.set(id, textEditorProxy);
  }

  /**
   * Host closes this portal
   */
  close() {

  }

}
