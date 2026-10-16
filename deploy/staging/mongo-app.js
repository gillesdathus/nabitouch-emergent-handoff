// Runs only on initialization of the new staging volume. Password never enters argv/logs.
const fs = require('fs');
const password = fs.readFileSync('/run/secrets/mongo_app_password', 'utf8').trim();
if (!password || password === 'replace-me') throw new Error('Supply a staging application password');
db.getSiblingDB('nabitouch_staging').createUser({user: 'staging_app', pwd: password, roles: [{role: 'readWrite', db: 'nabitouch_staging'}]});
