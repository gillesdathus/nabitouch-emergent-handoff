// Explicit operator step after authorization; never connects outside this container.
const fs = require('fs');
const admin = db.getSiblingDB('admin');
admin.auth('staging_root', fs.readFileSync('/run/secrets/mongo_root_password', 'utf8').trim());
try { rs.status(); } catch (error) {
  if (error.codeName !== 'NotYetInitialized') throw error;
  rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'mongo:27017'}]});
}
