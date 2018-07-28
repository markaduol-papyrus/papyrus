const PapyrusPackage = require('./lib/papyrus-package');
const PortalBindingManager = require('./lib/client/portal-binding-manager.js');
module.exports = new PapyrusPackage({
  workspace: atom.workspace,
  notificationManager: atom.notifications,
  clipboard: atom.clipboard,
  portalBindingManager: new PortalBindingManager({
    workspace: atom.workspace,
    notificationManager: atom.notifications
  })
});
