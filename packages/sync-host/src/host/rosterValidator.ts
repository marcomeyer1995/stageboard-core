/**
 * The band's write rules, once for every host (#962): the `_design/roster` validator a band database carries. A
 * role check, not a name check, so it never needs to change as members are added, removed or promoted.
 * `userCtx.roles` carries the roles of the login that makes the write: the `member` / `admin` roles of a device's
 * `account:` document, `host` for a host device, or `_admin` for the host itself. A database-level
 * `_security.admins` entry is not exempt from a validator, so every rule checks its role explicitly. Deliberately
 * plain ES5 - the host runs it in a sandbox of its own, not as Node code.
 */
export const ROSTER_VALIDATOR_SOURCE = `function(newDoc, oldDoc, userCtx) {
  var isAdmin = userCtx.roles.indexOf('admin') !== -1 || userCtx.roles.indexOf('_admin') !== -1;
  if (newDoc._id.indexOf('profiles:') === 0 && !isAdmin) {
    throw({forbidden: 'Only a band admin may edit the roster.'});
  }
  if ((newDoc._id.indexOf('account:') === 0 || newDoc._id.indexOf('anchor:') === 0) && userCtx.roles.indexOf('_admin') === -1 && userCtx.roles.indexOf('host') === -1) {
    throw({forbidden: 'Only a host writes the band accounts.'});
  }
  if (newDoc._id.indexOf('hosts:') === 0 && userCtx.roles.indexOf('_admin') === -1) {
    var device = newDoc._id.slice(6);
    var own = typeof userCtx.name === 'string' && userCtx.name.slice(-(device.length + 1)) === '~' + device;
    if (!own && !(newDoc._deleted && isAdmin)) {
      throw({forbidden: 'Only the tablet itself announces itself as a server.'});
    }
  }
  if (newDoc._id.indexOf('band-settings:') === 0 && !isAdmin) {
    throw({forbidden: 'Only a band admin may change the band settings.'});
  }
  if (newDoc._id.indexOf('dashboards:') === 0 && !isAdmin) {
    if (oldDoc && oldDoc.isReadOnly) {
      throw({forbidden: 'Only a band admin may change a protected dashboard template.'});
    }
    if (newDoc.isReadOnly) {
      throw({forbidden: 'Only a band admin may protect a dashboard as a template.'});
    }
  }
}`
