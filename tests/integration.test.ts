import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { io as client, type Socket } from 'socket.io-client';
import { createApp } from '../server/app';
import { db } from '../server/db';
import { randomUUID } from 'node:crypto';
const origin='http://127.0.0.1:5173';
const app=createApp(origin);let base='';const sockets:Socket[]=[];const ids:string[]=[];
async function request(path:string,body?:unknown,cookie?:string,source=origin){
  const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:source,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function register(name:string){const result=await request('/auth/register',{email:`${randomUUID()}@example.com`,displayName:name,password:'safe-password-123'});ids.push(result.data.id);return result;}
async function socket(cookie:string){const s=client(base,{extraHeaders:{Cookie:cookie,Origin:origin},transports:['websocket'],forceNew:true});sockets.push(s);await new Promise<void>((resolve,reject)=>{s.once('connect',()=>resolve());s.once('connect_error',reject);});return s;}
function ack(s:Socket,event:string,data:unknown):Promise<any>{return new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(error:Error|null,result:unknown)=>error?reject(error):resolve(result)));}
function once(s:Socket,event:string):Promise<any>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timeout ${event}`)),4000);s.once(event,data=>{clearTimeout(timer);resolve(data);});});}
beforeAll(async()=>{await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(app.http.address() as {port:number}).port}`;});
afterAll(async()=>{for(const s of sockets)s.disconnect();await new Promise<void>(resolve=>app.io.close(()=>resolve()));await db.conversation.deleteMany({where:{members:{some:{userId:{in:ids}}}}});await db.user.deleteMany({where:{id:{in:ids}}});await db.$disconnect();});
describe('real multi-user messenger',()=>{
  it('serves HTTP without forcing LAN assets to HTTPS',async()=>{
    const response=await fetch(base+'/');
    const policy=response.headers.get('content-security-policy')||'';
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(response.headers.get('strict-transport-security')).toBeNull();
  });
  it('keeps HTTPS upgrades and HSTS for an HTTPS deployment',async()=>{
    const secure=createApp('https://messenger.example');
    await new Promise<void>(resolve=>secure.http.listen(0,'127.0.0.1',resolve));
    try{
      const port=(secure.http.address() as {port:number}).port;
      const response=await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(response.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
      expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    }finally{await new Promise<void>(resolve=>secure.io.close(()=>resolve()));}
  });
  it('authenticates, isolates chats, persists, paginates and delivers idempotently',async()=>{
    expect((await request('/conversations')).status).toBe(401);
    expect((await request('/auth/register',{email:'bad',password:'tiny'})).status).toBe(400);
    const a=await register('Alice'),b=await register('Bob'),c=await register('Carol');
    expect(a.status).toBe(201);expect(a.cookie).toContain('nebula_session=');
    expect((await request('/auth/me',undefined,a.cookie)).data.displayName).toBe('Alice');
    expect((await request('/auth/login',{email:a.data.email,password:'wrong-password'})).status).toBe(401);
    expect((await request('/auth/login',{email:a.data.email,password:'safe-password-123'})).status).toBe(200);
    expect((await request('/auth/logout',{},a.cookie,'https://evil.example')).status).toBe(403);
    expect((await request('/users?search=Bob',undefined,a.cookie)).data.some((p:any)=>p.id===b.data.id)).toBe(true);
    const chat=(await request('/conversations',{userId:b.data.id},a.cookie)).data;
    expect((await request('/conversations',{userId:a.data.id},b.cookie)).data.id).toBe(chat.id);
    const sa=await socket(a.cookie),sb=await socket(b.cookie),sc=await socket(c.cookie);
    expect((await ack(sb,'conversation:join',{conversationId:chat.id})).ok).toBe(true);
    expect((await request(`/conversations/${chat.id}/messages`,undefined,c.cookie)).status).toBe(403);
    expect((await ack(sc,'conversation:join',{conversationId:chat.id})).ok).toBe(false);
    expect((await ack(sc,'typing:start',{conversationId:chat.id})).ok).toBe(false);
    expect((await ack(sc,'message:send',{conversationId:chat.id,body:'intrusion',clientMessageId:randomUUID()})).ok).toBe(false);
    const payload={conversationId:chat.id,body:'Привет <script>alert(1)</script>',clientMessageId:randomUUID()};
    const received=once(sb,'message:new');const saved=await ack(sa,'message:send',payload);
    expect(saved.ok).toBe(true);expect((await received).id).toBe(saved.data.id);
    expect((await ack(sa,'message:send',payload)).data.id).toBe(saved.data.id);
    expect((await ack(sa,'message:send',{...payload,body:'changed'})).ok).toBe(false);
    expect((await ack(sa,'message:send',{...payload,body:' '.repeat(10),clientMessageId:randomUUID()})).ok).toBe(false);
    const typing=once(sb,'typing:update');await ack(sa,'typing:start',{conversationId:chat.id});expect((await typing).active).toBe(true);
    const stopped=once(sb,'typing:update');expect((await stopped).active).toBe(false);
    sb.disconnect();await ack(sa,'message:send',{conversationId:chat.id,body:'offline delivery',clientMessageId:randomUUID()});
    const history=(await request(`/conversations/${chat.id}/messages?limit=1`,undefined,b.cookie)).data;
    expect(history.messages).toHaveLength(1);expect(history.messages[0].body).toBe('offline delivery');expect(history.nextCursor).toBeTruthy();
    const older=(await request(`/conversations/${chat.id}/messages?cursor=${history.nextCursor}`,undefined,b.cookie)).data;
    expect(older.messages).toHaveLength(1);expect(older.messages[0].body).toBe(payload.body);
    expect((await request(`/conversations/${chat.id}/messages?limit=nope`,undefined,a.cookie)).status).toBe(400);
    const stored=await db.user.findUniqueOrThrow({where:{id:a.data.id}});expect(stored.passwordHash).not.toContain('safe-password');
    const disconnected=once(sa,'disconnect');await request('/auth/logout',{},a.cookie);await disconnected;
    expect((await request('/auth/me',undefined,a.cookie)).status).toBe(401);
  },20000);
  it('tracks presence across two independent tabs',async()=>{
    const a=await register('Presence A'),b=await register('Presence B');
    const chat=(await request('/conversations',{userId:b.data.id},a.cookie)).data;
    const sa=await socket(a.cookie),sb=await socket(b.cookie),sb2=await socket(b.cookie);
    expect((await ack(sa,'conversation:join',{conversationId:chat.id})).data.online).toContain(b.data.id);
    sb.disconnect();await new Promise(resolve=>setTimeout(resolve,80));
    expect((await ack(sa,'conversation:join',{conversationId:chat.id})).data.online).toContain(b.data.id);
    const gone=once(sa,'presence:update');sb2.disconnect();expect((await gone).online).toBe(false);
  });
  it('recovers more than one page after a long offline interval',async()=>{
    const a=await register('Recovery A'),b=await register('Recovery B');
    const chat=(await request('/conversations',{userId:b.data.id},a.cookie)).data;
    await db.message.createMany({data:Array.from({length:125},(_,index)=>({conversationId:chat.id,senderId:a.data.id,body:`message ${index}`,clientMessageId:randomUUID()}))});
    const first=(await request(`/conversations/${chat.id}/messages?after=0&limit=100`,undefined,b.cookie)).data;
    expect(first.messages).toHaveLength(100);expect(first.nextAfter).toBeTruthy();
    const second=(await request(`/conversations/${chat.id}/messages?after=${first.nextAfter}&limit=100`,undefined,b.cookie)).data;
    expect(second.messages).toHaveLength(25);expect(second.nextAfter).toBeNull();
    expect(new Set([...first.messages,...second.messages].map(m=>m.id)).size).toBe(125);
  });
});
