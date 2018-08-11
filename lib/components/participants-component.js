'use babel';
/** @jsx etch.dom */

const etch = require('etch');
const $ = etch.dom;
const config = require('./../../config.js')
const log = require('loglevel').getLogger('participants-component');
log.setLevel(config.logLevels.views);
const _HOST_SITE_ID = 1;

class ParticipantsComponent {
  /**
   * Expected parameters
   * @param {Object} portalBinding - Potentially null reference to a
   * host-portal-binding
   * @param {Object} username - Username of the local peer
   */
  constructor(props) {
    this.props = Object.assign({}, props);
    etch.initialize(this);
  }

  update(props) {
    Object.assign(this.props, props);
    return etch.update(this);
  }

  render() {
    let participantComponents;

    if (this.props.portalBinding) {
      const activeSiteIds = this.props.portalBinding.getActiveSiteIds().sort(
        (a, b) => a - b
      );
      log.debug('Active Site IDs: ', activeSiteIds);
      participantComponents = activeSiteIds.map(siteId =>
        this._renderParticipant(
          siteId, this.props.portalBinding.getSiteIdentity(siteId)
        )
      );
    } else {
      participantComponents =
        [this._renderParticipant(_HOST_SITE_ID, this.props.username)];
    }

    let hasGuestPeers;
    if (!this.props.portalBinding) {
      hasGuestPeers = false;
    } else {
      hasGuestPeers = this.props.portalBinding.hasGuestPeers();
    }
    log.debug('Participant Components: ', participantComponents);

    return (
      <div className="PortalParticipants">
        {participantComponents[0]}
        <div className="PortalParticipants-guests">
          {hasGuestPeers ? participantComponents.slice(1): null}
        </div>
      </div>
    );
  }

  _renderParticipant(siteId, participantUsername) {
    // Arbitrary percentages used
    //const avatarSize = siteId === _HOST_SITE_ID ? 56 : 44;
    return (
      <div className={
        `PortalParticipants-participant PortalParticipants-site-${siteId}`
      }>
        <img src={'https://as2.ftcdn.net/jpg/01/88/16/11/500_F_188161178_iyfS7Nv8tPefqfIFYaVF1ZdoDXW6w3LV.jpg'}/>
        {participantUsername}
      </div>
    );
  }
}

module.exports = ParticipantsComponent;
