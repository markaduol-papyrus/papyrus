'use babel';
/** @jsx etch.dom */

const { CompositeDisposable } = require('atom');
const etch = require('etch');
const $ = etch.dom;
const config = require('./../config.js')
const log = require('loglevel').getLogger('participants-component');
log.setLevel(config.logLevels.views);
const _HOST_SITE_ID = 1;

class ParticipantsComponent {
  /**
   * Expected parameters
   * @param {HostPortalBinding} portalBinding Host portal binding
   * @param {string} username Username of local peer
   */
  constructor(props) {
    this.props = Object.assign({}, props);
    this.subscriptions = new CompositeDisposable();
    this._subscribeToPortalBindingChanges(this.props.portalBinding);
    etch.initialize(this);
  }

  update(props) {
    log.debug('Updating ParticipantsComponent: ', props);

    if (props.portalBinding !== this.props.portalBinding) {
      this._subscribeToPortalBindingChanges(props.portalBinding);
    }
    Object.assign(this.props, props);
    return etch.update(this);
  }

  _subscribeToPortalBindingChanges(portalBinding) {
    const logObj = {portalBinding: portalBinding};
    log.debug('Subscribing to portal-binding changes: ', logObj);

    this.subscriptions.dispose();
    if (portalBinding) {
      this.subscriptions.add(
        portalBinding.onAcceptedJoinPortalRequest(() => {
          return etch.update(this);
        })
      );

      this.subscriptions.add(
        portalBinding.onAcceptedLeavePortalRequest(() => {
          return etch.update(this);
        })
      );
    }
  }

  render() {
    let participantComponents = [];

    if (this.props.portalBinding) {
      let activeSiteIds = this.props.portalBinding.getActiveSiteIds();
      log.debug('Active Site IDs: ', activeSiteIds);

      // NOTE: Non-stable sort
      activeSiteIds.sort((a, b) => {
        return a - b
      });

      log.debug('Active Site IDs: ', activeSiteIds);

      for (let i = 0; i < activeSiteIds.length; i++) {
        const siteId = activeSiteIds[i];
        const username = this.props.portalBinding.getUsernameBySiteId(siteId);
        const participantComponent = this._renderParticipant(siteId, username);
        participantComponents.push(participantComponent);
      }
    } else {
      participantComponents =
        [this._renderParticipant(_HOST_SITE_ID, this.props.username)];
    }

    let hasGuestPeers = false;
    if (this.props.portalBinding) {
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
