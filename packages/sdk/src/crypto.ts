import sodium from 'libsodium-wrappers-sumo';

export interface KdfParameters {
  algorithm: 'argon2id13';
  operations: number;
  memoryBytes: number;
  parallelism: 1;
}

export interface EncryptedEnvelope {
  version: 1;
  algorithm: 'xchacha20poly1305-ietf';
  kdf: KdfParameters;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export const DEFAULT_KDF: KdfParameters = {
  algorithm: 'argon2id13',
  operations: 2,
  memoryBytes: 19 * 1024 * 1024,
  parallelism: 1,
};

const variant = () => sodium.base64_variants.URLSAFE_NO_PADDING;
export const toBase64 = (value: Uint8Array): string => sodium.to_base64(value, variant());
export const fromBase64 = (value: string): Uint8Array => sodium.from_base64(value, variant());

export async function ready(): Promise<void> { await sodium.ready; }

export async function deriveKey(password: string, salt: Uint8Array, params = DEFAULT_KDF): Promise<Uint8Array> {
  await ready();
  if (password.length < 10) throw new Error('Password must contain at least 10 characters');
  if (params.memoryBytes < 19 * 1024 * 1024 || params.operations < 2) throw new Error('KDF parameters are below the supported security floor');
  return sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    password,
    salt,
    params.operations,
    params.memoryBytes,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
    'uint8array',
  ) as Uint8Array;
}

export async function encryptBytes(
  plaintext: Uint8Array,
  password: string,
  associatedData: string,
  params = DEFAULT_KDF,
): Promise<EncryptedEnvelope> {
  await ready();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = await deriveKey(password, salt, params);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    sodium.from_string(associatedData),
    null,
    nonce,
    key,
    'uint8array',
  ) as Uint8Array;
  sodium.memzero(key);
  return { version: 1, algorithm: 'xchacha20poly1305-ietf', kdf: params, salt: toBase64(salt), nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
}

export async function decryptBytes(envelope: EncryptedEnvelope, password: string, associatedData: string): Promise<Uint8Array> {
  await ready();
  if (envelope.version !== 1 || envelope.algorithm !== 'xchacha20poly1305-ietf') throw new Error('Unsupported encrypted envelope');
  const key = await deriveKey(password, fromBase64(envelope.salt), envelope.kdf);
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(envelope.ciphertext),
      sodium.from_string(associatedData),
      fromBase64(envelope.nonce),
      key,
      'uint8array',
    ) as Uint8Array;
  } catch {
    throw new Error('Wrong password or damaged encrypted data');
  } finally {
    sodium.memzero(key);
  }
}

export async function wrapKey(dataKey: Uint8Array, password: string): Promise<EncryptedEnvelope> {
  return encryptBytes(dataKey, password, 'utm:workspace-key:v1');
}

export async function unwrapKey(envelope: EncryptedEnvelope, password: string): Promise<Uint8Array> {
  return decryptBytes(envelope, password, 'utm:workspace-key:v1');
}

export async function encryptWithKey(plaintext: Uint8Array, dataKey: Uint8Array, associatedData: string): Promise<{ nonce: string; ciphertext: string }> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext, sodium.from_string(associatedData), null, nonce, dataKey, 'uint8array',
  ) as Uint8Array;
  return { nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
}

export async function decryptWithKey(encrypted: { nonce: string; ciphertext: string }, dataKey: Uint8Array, associatedData: string): Promise<Uint8Array> {
  await ready();
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, fromBase64(encrypted.ciphertext), sodium.from_string(associatedData), fromBase64(encrypted.nonce), dataKey, 'uint8array',
    ) as Uint8Array;
  } catch { throw new Error('Encrypted local data failed authentication'); }
}

export async function digest(value: Uint8Array): Promise<string> {
  await ready();
  return toBase64(sodium.crypto_generichash(32, value, null) as Uint8Array);
}

export async function randomKey(): Promise<Uint8Array> {
  await ready();
  return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
}
