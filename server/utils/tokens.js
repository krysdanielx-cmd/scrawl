import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'scrawl-api';
const AUDIENCE = 'scrawl-web';

export function createToken(userId) {
  return jwt.sign({}, env.JWT_SECRET, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
}
