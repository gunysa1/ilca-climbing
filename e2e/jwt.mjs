// HS256 JWT for the e2e PostgREST (never use outside tests).
import { createHmac } from 'node:crypto';
export function jwt(secret, role, sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, ...(sub && { sub }), exp: 4102444800 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(jwt(process.argv[2], process.argv[3], process.argv[4]));
