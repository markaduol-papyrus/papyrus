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
  constructor(textBuffer, id) {
    // Bind atom 'TextBuffer'
    this.textBuffer = textBuffer;
    // Assign unique ID which should be equal to text buffer's URI
    this.id = id || this.textBuffer.getUri();
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
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
    this.subscriptions.add(this.textBuffer.onDidChange(changeEvent => {
      this._handleTextBufferChange(changeEvent);
    }))
  }

  deactivateListeners() {
    this.subscriptions.dispose();
  }

  /**
   * Tear down the TextBufferProxy
   */
  destroy() {
    this.subscriptions.dispose();
  }

  async _handleTextBufferChange(myEvent) {
    log.debug('Handling text buffer change: ', {event: myEvent});

    log.debug('Text hashes: ', {textHashes: this.textHashes});

    // Message to be broadcast to observers
    let msg;

    for (let {oldRange, newRange, oldText, newText} of myEvent.changes) {
      // Check if change has already been applied
      const hash1 = hash(oldRange.toString() + oldText);
      const hash2 = hash(newRange.start.toString() + newText);

      log.debug('Hash 1 (oldRange + oldText): ', {hash: hash1});
      log.debug('Hash 2 (newRange.start + newText): ', {hash: hash2});

      if (this.textHashes.has(hash1)) {
        let logObj = {oldRange: oldRange, oldText: oldText};
        log.debug('Already applied deletion: ', logObj);
        this.textHashes.delete(hash1);
        continue;
      }
      if (this.textHashes.has(hash2)) {
        let logObj = {newRangeStart: newRange.start, newText: newText};
        log.debug('Already applied insertion: ', logObj);
        this.textHashes.delete(hash2);
        continue;
      }

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

      // Notify observers
      this.emitter.emit('did-emit-message', msg);
    }
  }


  /**
   * @param {Point} point - The Atom 'Point' object used for insertion.
   * @param {String} text - The text to insert.
   */
  insertIntoTextBuffer(point, text) {
    log.debug('Doing insertion: ', {point: point, text: text});

    return new Promise((resolve) => {
      // HACK: Temporary while remote insertion of CRDT is being tested
      const clippedPoint = this.textBuffer.clipPosition(point);

      // Hash insertion point + text-to-insert and store result
      const hashValue = hash(clippedPoint.toString() + text);
      log.debug('Insertion hash: ', hashValue);

      this.textHashes.add(hashValue);
      resolve();

    }).then(() => {

      // Insert into text buffer
      this.textBuffer.insert(point, text);

    }).catch(error => {
      log.error(error);
    });
  }


  /**
   * @param {Range} range - The Atom 'Range' object used to specify the
   * deletion range in the text buffer.
   */
  deleteFromTextBuffer(range) {
    log.debug('Doing deletion: ', {range: range});

    return new Promise((resolve) => {

      // Get text that will be deleted
      const textToDelete = this.textBuffer.getTextInRange(range);
      resolve(textToDelete);

    }).then(textToDelete => {

      // Hash deletion range + text-to-delete and store the result
      const hashValue = hash(range.toString() + textToDelete);
      log.debug('Deletion hash: ', hashValue);

      this.textHashes.add(hashValue);

    }).then(() => {

      // Do deletion from text buffer
      this.textBuffer.delete(range);
      
    }).catch(error => {
      log.error(error);
    });
  }
}

module.exports = TextBufferProxy;
