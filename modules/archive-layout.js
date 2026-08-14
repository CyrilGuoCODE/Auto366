const fs = require('fs');
const path = require('path');

/**
 * Return the directory that should become the resource destination.
 *
 * Resource manifests already provide extractTo (for example, "tun"). Older
 * archives sometimes repeat that directory inside the ZIP, which would
 * otherwise install files under resources/tun/tun and make them undiscoverable.
 */
function resolveExtractedRoot(extractDir, extractTo) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return extractDir;

  const expectedName = path.basename(path.normalize(extractTo));
  return entries[0].name.toLowerCase() === expectedName.toLowerCase()
    ? path.join(extractDir, entries[0].name)
    : extractDir;
}

module.exports = { resolveExtractedRoot };
