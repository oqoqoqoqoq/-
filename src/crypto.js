// Web Crypto API 기반 JWT (Node.js 없이 Workers에서 동작)

const encoder = new TextEncoder();

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

export async function signJWT(payload, secret, expiresInHours = 8) {
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const body = base64url(encoder.encode(JSON.stringify({ ...payload, exp })));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const key = await getKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC', key,
    base64urlDecode(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// bcrypt 대신 SHA-256 기반 단순 해시 (Workers 환경)
export async function hashPassword(password) {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(password + 'graduation-salt'));
  return base64url(buf);
}

export async function verifyPassword(password, hash) {
  return (await hashPassword(password)) === hash;
}
