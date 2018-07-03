'use babel';

import PapyrusView from './papyrus-view';
import { CompositeDisposable } from 'atom';
import TextBufferProxy from './client/text-buffer-proxy.js';

export default {

  papyrusView: null,
  modalPanel: null,
  subscriptions: null,

  activate(state) {
    this.papyrusView = new PapyrusView(state.papyrusViewState);
    this.modalPanel = atom.workspace.addModalPanel({
      item: this.papyrusView.getElement(),
      visible: false
    });

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register command that toggles this view
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'papyrus:toggle': () => this.toggle()
    }));
  },

  deactivate() {
    this.modalPanel.destroy();
    this.subscriptions.dispose();
    this.papyrusView.destroy();
  },

  serialize() {
    return {
      papyrusViewState: this.papyrusView.serialize()
    };
  },

  observeTextBuffers() {
    let textBufferURIs = new Set();
    // We can't access all TextBuffer[s] directly, so we have to go through
    // TextEditor[s]

    // We need to initialise the Controller with the active text editor
    let editor;
    if (editor = atom.workspace.getActiveTextEditor()) {
      let textBuffer = editor.getBuffer();
      let uri = textBuffer.getUri();
      textBufferURIs.add(uri);
      let textBufferProxy = new TextBufferProxy(textBuffer);
      textBufferProxy.fireUp();
    }

    atom.workspace.observeTextEditors(editor => {
      let textBuffer = editor.getBuffer();
      let uri = textBuffer.getUri();

      if (!textBufferURIs.has(uri)) {
        textBufferURIs.add(uri);
        // Initialise proxy
        let textBufferProxy = new TextBufferProxy(textBuffer);
        textBufferProxy.fireUp();
      }
    });
  },

  observeActiveTextBuffer() {
    let textBufferURIs = new Set();
    let controller = new Controller();

    atom.workspace.observeActiveTextEditor(editor => {
      let textBuffer = editor.getBuffer();
      let uri = textBuffer.getUri();

      if (!textBufferURIs.has(uri)) {
        textBufferURIs.add(uri);
        // Initialise proxy
        let textBufferProxy = new TextBufferProxy(textBuffer);
        textBufferProxy.fireUp();
        // Add the text buffer proxy to the controller so that the controller
        // can UPDATE the text buffer proxy based on REMOTE EVENTS.
        controller.addTextBufferProxy(textBufferProxy);
        // Register the controller as an observer of the text buffer proxy, so
        // that the text buffer proxy can NOTIFY the controller of LOCAL EVENTS.
        textBufferProxy.registerObserver(controller);
      }
    });
  }

  toggle() {
    console.log('Papyrus was toggled!');
    //return (
      //this.modalPanel.isVisible() ?
      //this.modalPanel.hide() :
      //this.modalPanel.show()
    //);
  },

  createPortal() {
    this.observeActiveTextBuffer();
  }
};
