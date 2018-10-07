const PapyrusPackage = require('./lib/papyrus-package');
module.exports = new PapyrusPackage({
  workspace: atom.workspace,
  notificationManager: atom.notifications,
  clipboard: atom.clipboard,
  tooltipManager: atom.tooltips,
  commandRegistry: atom.commands,
});
