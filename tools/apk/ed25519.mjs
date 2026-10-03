// ed25519.mjs — raw-key Ed25519 helpers shared by the signing CLI and the build.
//
// Node only accepts DER/PEM/JWK key objects, so raw 32-byte seeds and public keys are wrapped
// in the fixed RFC 8410 prefixes here. Signing is local-only (the private key never enters the
// repo or CI); the build uses `verify` to check a fetched list before baking it into the APK.
import crypto from 'node:crypto';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function privateKeyFromSeed(seed) {
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function publicKeyFromRaw(raw) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function rawPublicOf(privateKey) {
  const der = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}

export function seedOf(privateKey) {
  return privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_PREFIX.length);
}

/** 64-byte Ed25519 signature over `bytes`. */
export function sign(bytes, seed) {
  return crypto.sign(null, bytes, privateKeyFromSeed(seed));
}

/** Verifies `sig` over `bytes` against a raw 32-byte public key. */
export function verify(bytes, sig, rawPub) {
  return crypto.verify(null, bytes, publicKeyFromRaw(rawPub), sig);
}

export function generateSeed() {
  return seedOf(crypto.generateKeyPairSync('ed25519').privateKey);
}
