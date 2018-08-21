const { Point, Range } = require('atom');
const { ANIMALS, ADJECTIVES } = require('./default-usernames.js');
const log = require('loglevel').getLogger('portal-helpers');
const config = require('./../config.js');

// CRDT
const { Identifier, Char, CRDT } = require('papyrus-crdt');

// Logging setup
log.setLevel(config.logLevels.models);

function _getRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

module.exports = {

  /**
   * Convert the object {lineIndex: ..., charIndex: ...} to an Atom `Range` object
   */
  convertPositionsToRange: (startPos, endPos) => {
    const logObj = {startPos: startPos, endPos: endPos};
    log.debug('Converting positions to Range: ', logObj);

    const startPoint = [startPos.lineIndex, startPos.charIndex];
    const endPoint = [endPos.lineIndex, endPos.charIndex];
    return new Range(startPoint, endPoint);
  },

  /**
   * Convert the given position to an atom `Point` object
   */
  convertPositionToPoint: (position) => {
    const logObj = {position: position};
    log.debug('Converting position to Point: ', logObj);

    return new Point(position.lineIndex, position.charIndex);
  },

  /**
   * Populate the CRDT structure of the given text buffer proxy.
   */
  populateCRDT: (bufferProxy, siteId) => {
    const logObj = {bufferProxy: bufferProxy};
    log.debug('Populating CRDT: ', logObj);

    return new Promise((resolve) => {
      if (!siteId) {
        log.warn('Undefined site ID: ' + siteId);
      }

      let crdt = new CRDT(siteId);
      let lines = bufferProxy.getBuffer().getLines();
      let char;
      let position;

      for (let i = 0; i < lines.length; i++) {
        for (let j = 0; j <= lines[i].length; j++) {
          if (j === lines[i].length) {
            char = '\n';
          } else {
            char = lines[i][j];
          }
          position = {lineIndex: i, charIndex: j};
          crdt.handleLocalInsert(char, position);
        }
      }
      resolve(crdt);
    });
  },

  /**
   * Get a random element from an array
   */
  getRandom: _getRandom,

  /**
   * Create a random username to be assigned to a peer
   */
  createRandomUsername: () => {
    return _getRandom(ADJECTIVES) + '_' + _getRandom(ANIMALS);
  },

  /**
   * Strip the username, if it exists, from the buffer proxy ID.
   */
  getPortalHostUsernameFromBufferProxyId: (bufferProxyId) => {
    const logObj = {bufferProxyId: bufferProxyId};
    log.debug('Getting portal host username from buffer proxy ID: ', logObj);

    const [username, rawBufferProxyId] = bufferProxyId.split('/');
    return username;
  },

  /**
   * Deserialize the given structure into a `Char` object
   */
  deserializeCharObject: (serializedCharObj) => {
    const {siteId, idArray, value} = serializedCharObj;
    let deserializedIdArray = [];

    for (let i = 0; i < idArray.length; i++) {
      if (idArray[i].siteId !== siteId) {
        const logObj = {
          siteIdFromCharObject: siteId,
          siteIdFromIdArray: idArray[i].siteId,
          idArrayIndex: i,
        };
        log.warn('Inconsistent site IDs: ', logObj);
      }

      const identifier = new Identifier(idArray[i].value, idArray[i].siteId);
      deserializedIdArray.push(identifier);
    }
    const deserializedCharObj = new Char(value, deserializedIdArray);
    return deserializedCharObj;
  },
}
