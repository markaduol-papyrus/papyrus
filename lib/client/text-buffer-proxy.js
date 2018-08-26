'use babel';

const { Emitter, CompositeDisposable } = require('atom');
const MessageTypes = require('./message-types.js');
const MessageBuilder = require('./message-builder.js');
const hash = require('string-hash');
const TEXT_BUFFER_PROXY_INSERT = MessageTypes.TEXT_BUFFER_PROXY_INSERT;
const TEXT_BUFFER_PROXY_DELETE = MessageTypes.TEXT_BUFFER_PROXY_DELETE;

// Logging
const log = require('loglevel').getLogger('text-buffer-proxy');
const config = require('./../config.js')
log.setLevel(config.logLevels.textBufferProxy);

/** MISCELLANOUS HELPER FUNCTIONS */

/**
 * Convert an Atom `Range` object to a {lineIndex: ..., charIndex: ...} object
 */
function _convertRangeToPos(atomRangeObj) {
  const startPoint = atomRangeObj.start;
  const endPoint = atomRangeObj.end;
  const startPos = {lineIndex: startPoint.row, charIndex: startPoint.column};
  const endPos = {lineIndex: endPoint.row, charIndex: endPoint.column};
  return [startPos, endPos]
}

/** TEXT BUFFER PROXY */

class TextBufferProxy {
  constructor(textBuffer) {
    // Bind atom 'TextBuffer'
    this.textBuffer = textBuffer;
    // Assign unique ID which should be equal to text buffer's URI
    this.id = this.textBuffer.getUri();
    this.emitter = new Emitter();
    this.textBufferSubscriptions = new CompositeDisposable();
    this.textHashes = new Set();
  }

  getId() {
    return this.id;
  }

  /**
   * Return the text buffer
   */
  getBuffer() {
    return this.textBuffer;
  }

  /**
   * Used by external modules to register callbacks to be executed upon emission
   * of some event
   */
  onDidEmitMessage(callback) {
    this.emitter.on('did-emit-message', callback);
  }

  /**
   * Start listening to events from the TextBuffer attached to this class.
   */
  activateListeners() {
    this._setupTextBufferHandlers();
  }

  /**
   * Tear down the TextBufferProxy
   */
  destroy() {
    this.textBufferSubscriptions.dispose();
  }

  _setupTextBufferHandlers() {
    // Wrap in a CompositeDisposable for easy disposing of listener once we
    // want to unsubscribe to events from the text buffer.
    this.textBufferSubscriptions.add(
      this.textBuffer.onDidChange(this._handleTextBufferChange.bind(this))
    );
  }

  _handleTextBufferChange(event) {
    log.debug('Handling text buffer change: ', {event: event});

    log.debug('Text hashes: ', {textHashes: this.textHashes});
    const {newRange, oldRange, newText} = event;
    const hash1 = hash(oldRange.toString());
    const hash2 = hash(newRange.toString() + newText);
    if (this.textHashes.has(hash1)) {
      log.debug('Already applied change: ', event);
      this.textHashes.delete(hash1);
      return;
    }
    if (this.textHashes.has(hash2)) {
      log.debug('Already applied change: ', event);
      this.textHashes.delete(hash2);
      return;
    }

    // Message to be broadcast to observers
    let msg;

    for (const {oldRange, newRange, oldText, newText} of event.changes) {
      if (oldText.length > 0) {
        // Delete text
        const [startPos, endPos] = _convertRangeToPos(oldRange);

        msg = new MessageBuilder().
              setType(TEXT_BUFFER_PROXY_DELETE).
              setTextBufferProxyId(this.id).
              setStartPos(startPos).
              setEndPos(endPos).
              getResult();
      }
      if (newText.length > 0) {
        // Insert text
        const [startPos, _] = _convertRangeToPos(newRange);

        msg = new MessageBuilder().
              setType(TEXT_BUFFER_PROXY_INSERT).
              setTextBufferProxyId(this.id).
              setStartPos(startPos).
              setNewText(newText).
              getResult();
      }
    }

    // Notify observers
    this.emitter.emit('did-emit-message', msg);
  }


  /**
   * @param {Point} point - The Atom 'Point' object used for insertion.
   * @param {String} text - The text to insert.
   */
  insertIntoTextBuffer(point, text) {
    return new Promise(async (resolve, reject) => {
      try {
        const newRange = await this.textBuffer.insert(point, text);
        await this.textHashes.add(hash(newRange.toString() + text));
        log.debug('Text hashes: ', {textHashes: this.textHashes});
        await this.textBuffer.save();
        resolve();
      } catch (error) {
        log.error(error);
        reject(error);
      }
    });
  }

  /**
   * @param {Range} range - The Atom 'Range' object used to specify the
   * deletion range in the text buffer.
   */
  deleteFromTextBuffer(range) {
    return new Promise(async (resolve, reject) => {
      try {
        const oldRange = this.textBuffer.delete(range);
        await this.textHashes.add(hash(oldRange.toString()));
        log.debug('Text hashes: ', {textHashes: this.textHashes});
        await this.textBuffer.save();
        resolve();
      } catch (error) {
        log.error(error);
        reject(error);
      }
    });
  }
}

module.exports = TextBufferProxy;
