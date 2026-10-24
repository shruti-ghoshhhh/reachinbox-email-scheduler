const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  throw new Error('Create backend/.env from .env.example before configuring the queue dashboard.');
}
let source = fs.readFileSync(envPath, 'utf8');
const values = dotenv.parse(source);
function setValue(key, value) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, 'm');
  source = pattern.test(source) ? source.replace(pattern, () => line) : `${source.trimEnd()}\n${line}\n`;
}
if (!values.ADMIN_USERNAME || values.ADMIN_USERNAME === 'reviewer') setValue('ADMIN_USERNAME', 'reviewer');
if (!values.ADMIN_PASSWORD || /^(replace_|your_)/i.test(values.ADMIN_PASSWORD)) {
  setValue('ADMIN_PASSWORD', randomBytes(24).toString('base64url'));
} else if (values.ADMIN_PASSWORD.length < 16) {
  throw new Error('Existing ADMIN_PASSWORD is too short; set at least 16 characters in backend/.env.');
}
if (source !== fs.readFileSync(envPath, 'utf8')) fs.writeFileSync(envPath, source, 'utf8');
console.log('Queue dashboard credentials configured in backend/.env. Existing non-placeholder credentials are preserved.');
console.log('Restart the API, then open /admin/queues. Read ADMIN_USERNAME and ADMIN_PASSWORD from .env; credentials are not printed.');
