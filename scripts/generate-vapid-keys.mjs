// Generates the key pair needed for background push notifications.
// Run once:   node scripts/generate-vapid-keys.mjs
// Then paste both values into Netlify → Site configuration → Environment variables.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);

console.log('VAPID_PUBLIC_KEY=' + raw.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + priv.d);
