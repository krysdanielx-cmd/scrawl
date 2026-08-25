import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-at-least-twenty';
process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-thirty-two-characters';
process.env.JWT_EXPIRES_IN ||= '7d';

const { createToken, verifyToken } = await import('../utils/tokens.js');

const token = createToken('00000000-0000-4000-8000-000000000001');
const payload = verifyToken(token);
assert.equal(payload.sub, '00000000-0000-4000-8000-000000000001');
assert.equal(payload.iss, 'scrawl-api');
assert.equal(payload.aud, 'scrawl-web');

assert.throws(() => verifyToken(`${token.slice(0, -1)}x`));

const expired = jwt.sign({}, process.env.JWT_SECRET, {
  subject: '00000000-0000-4000-8000-000000000001',
  issuer: 'scrawl-api',
  audience: 'scrawl-web',
  expiresIn: -1,
  algorithm: 'HS256',
});
assert.throws(() => verifyToken(expired), /expired/i);

console.log('PASS valid JWT claims');
console.log('PASS tampered JWT rejected');
console.log('PASS expired JWT rejected');
