// ---------------------------------------------------------------------------
// Server-side secret storage for API credentials.
//
// Keys are encrypted with AES-256-GCM before they touch the database. The
// encryption key comes from FG_SECRET_KEY when set, otherwise a 0600 key file
// is generated once under server/data. Credentials are NEVER returned to the
// browser — only a masked hint (last 4 characters) is exposed.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, 'data', '.fg-secret');

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  let material = process.env.FG_SECRET_KEY || '';
  if (!material) {
    try {
      if (!fs.existsSync(SECRET_FILE)) {
        fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
        fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
        console.log('[crypto] Generated local secret key at server/data/.fg-secret');
      }
      material = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    } catch (e) {
      console.error('[crypto] Could not read/generate secret key:', e.message);
    }
  }
  // Derive a stable 256-bit key from whatever material we have.
  cachedKey = material
    ? crypto.createHash('sha256').update(material).digest()
    : crypto.randomBytes(32); // ephemeral fallback (keys unreadable after restart)
  return cachedKey;
}

export function encryptSecret(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(blob) {
  if (!blob) return '';
  try {
    const [version, ivB64, tagB64, dataB64] = String(blob).split(':');
    if (version !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Safe preview for the UI. Never exposes more than the last four characters. */
export function secretHint(blob) {
  const value = decryptSecret(blob);
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}
