// Database type definitions for Auto366

/**
 * Ruleset status enum
 */
export const RulesetStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
}

/**
 * Ruleset database model
 * @typedef {Object} Ruleset
 * @property {string} id - UUID primary key
 * @property {string} name - Ruleset name
 * @property {string} description - Ruleset description
 * @property {string} author - Author name
 * @property {string} status - Status (pending, approved, rejected)
 * @property {number} json_file_size - Size of JSON file in bytes
 * @property {number|null} zip_file_size - Size of ZIP file in bytes (optional)
 * @property {boolean} has_injection_package - Whether ruleset has ZIP package
 * @property {number} download_count - Number of downloads
 * @property {string} created_at - Creation timestamp
 * @property {string} updated_at - Last update timestamp
 * @property {string|null} approved_at - Approval timestamp
 * @property {string|null} approved_by - UUID of approving admin
 */

/**
 * Admin profile database model
 * @typedef {Object} AdminProfile
 * @property {string} id - UUID primary key (references auth.users)
 * @property {string} email - Admin email
 * @property {string} created_at - Creation timestamp
 * @property {string|null} last_login - Last login timestamp
 */

/**
 * Database table names
 */
export const Tables = {
  RULESETS: 'rulesets',
  ADMIN_PROFILES: 'admin_profiles'
}

/**
 * Database functions and RPC calls
 */
export const DatabaseFunctions = {
  INCREMENT_DOWNLOAD_COUNT: 'increment_download_count'
}