import { createHash, randomBytes } from 'node:crypto';
import { parse, serialize } from 'cookie';
import { db, publicUser } from './db';
export const hash = (token:string) => createHash('sha256').update(token).digest('hex');
export async function session(cookie = '') {
  const token = parse(cookie).nebula_session;
  if (!token) return null;
  const found = await db.session.findUnique({where:{tokenHash:hash(token)},include:{user:{select:publicUser}}});
  return found && found.expiresAt > new Date() ? found : null;
}
export async function newSession(userId:string) {
  const token = randomBytes(32).toString('hex');
  await db.session.create({data:{userId,tokenHash:hash(token),expiresAt:new Date(Date.now()+7*86400000)}});
  return cookieHeader(token,7*86400);
}
export function cookieHeader(token:string,maxAge:number) {
  return serialize('nebula_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge});
}
