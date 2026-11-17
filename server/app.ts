import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import { z, ZodError } from 'zod';
import { db, publicUser } from './db';
import { session, newSession, cookieHeader } from './auth';
import { HttpError, idSchema, membership, saveMessage } from './service';

export function createApp(origin=process.env.APP_ORIGIN || 'http://127.0.0.1:5173') {
  const app = express();
  const http = createServer(app);
  const io = new Server(http,{cors:{origin,credentials:true},allowRequest:(req,done)=>done(null,!req.headers.origin||req.headers.origin===origin)});
  const usesHttps = new URL(origin).protocol === 'https:';
  app.use(helmet({
    contentSecurityPolicy:{directives:{'upgrade-insecure-requests':usesHttps?[]:null}},
    strictTransportSecurity:usesHttps?undefined:false,
  }),cors({origin,credentials:true}),express.json({limit:'24kb'}));
  app.use('/api',(req,res,next)=> {
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin!==origin) {res.status(403).json({error:'Недопустимый источник запроса'});return;}
    next();
  });
  app.get('/api/health',(_req,res)=>res.json({ok:true}));
  app.use('/api/auth',rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много запросов. Попробуйте через минуту.'}}));
  const credentials = z.object({email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(10).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72)});
  for(const kind of ['register','login'] as const) app.post(`/api/auth/${kind}`,async(req,res)=> {
    const data = credentials.parse(req.body);
    let user;
    if(kind==='register') {
      const {displayName}=z.object({displayName:z.string().trim().min(1).max(60)}).parse(req.body);
      try {user=await db.user.create({data:{email:data.email,displayName,passwordHash:await bcrypt.hash(data.password,12)}});}
      catch(e) {if((e as {code?:string}).code==='P2002') throw new HttpError(409,'Этот email уже зарегистрирован');throw e;}
    } else {
      user=await db.user.findUnique({where:{email:data.email}});
      if(!user || !await bcrypt.compare(data.password,user.passwordHash)) throw new HttpError(401,'Неверный email или пароль');
    }
    res.setHeader('Set-Cookie',await newSession(user.id));
    res.status(kind==='register'?201:200).json({id:user.id,email:user.email,displayName:user.displayName});
  });
  app.use('/api',async(req,res,next)=> {
    const current=await session(req.headers.cookie);
    if(!current) {res.status(401).json({error:'Войдите в аккаунт'});return;}
    res.locals.session=current;next();
  });
  app.get('/api/auth/me',(_req,res)=>res.json(res.locals.session.user));
  app.post('/api/auth/logout',async(_req,res)=> {
    const current=res.locals.session;
    await db.session.deleteMany({where:{tokenHash:current.tokenHash}});
    io.in(`session:${current.tokenHash}`).disconnectSockets(true);
    res.setHeader('Set-Cookie',cookieHeader('',0));res.json({ok:true});
  });
  app.get('/api/users',async(req,res)=> {
    const search=z.string().trim().max(100).parse(req.query.search||'');
    res.json(search ? await db.user.findMany({where:{id:{not:res.locals.session.userId},OR:[{displayName:{contains:search}},{email:{contains:search}}]},select:publicUser,take:30}) : []);
  });
  const include={members:{include:{user:{select:publicUser}}},messages:{orderBy:{id:'desc' as const},take:1}};
  app.get('/api/conversations',async(_req,res)=>res.json(await db.conversation.findMany({where:{members:{some:{userId:res.locals.session.userId}}},include,orderBy:[{updatedAt:'desc'},{id:'desc'}]})));
  app.post('/api/conversations',async(req,res)=> {
    const {userId}=z.object({userId:idSchema}).parse(req.body);
    const me=res.locals.session.userId;
    if(userId===me) throw new HttpError(400,'Выберите другого пользователя');
    if(!await db.user.findUnique({where:{id:userId}})) throw new HttpError(404,'Пользователь не найден');
    const directKey=[me,userId].sort().join(':');
    const conversation=await db.conversation.upsert({where:{directKey},update:{},create:{directKey,members:{create:[{userId:me},{userId}]}},include});
    for(const member of conversation.members) io.to(`user:${member.userId}`).emit('conversation:update');
    res.json(conversation);
  });
  app.get('/api/conversations/:id/messages',async(req,res)=> {
    const id=idSchema.parse(req.params.id);await membership(res.locals.session.userId,id);
    const limit=z.coerce.number().int().min(1).max(100).parse(req.query.limit||50);
    if(req.query.after!==undefined){
      const after=z.coerce.number().int().min(0).parse(req.query.after);
      const items=await db.message.findMany({where:{conversationId:id,id:{gt:after}},orderBy:{id:'asc'},take:limit+1});
      const messages=items.slice(0,limit);
      res.json({messages,nextAfter:items.length>limit?messages[messages.length-1].id:null});return;
    }
    const cursor=req.query.cursor ? z.coerce.number().int().positive().parse(req.query.cursor):undefined;
    const items=await db.message.findMany({where:{conversationId:id,...(cursor?{id:{lt:cursor}}:{})},orderBy:{id:'desc'},take:limit+1});
    const more=items.length>limit;const messages=items.slice(0,limit).reverse();
    res.json({messages,nextCursor:more?messages[0].id:null});
  });
  const counts=new Map<string,number>();
  const socketRate=new Map<string,{count:number,until:number}>();
  const typing=new Map<string,ReturnType<typeof setTimeout>>();
  async function audience(userId:string) {
    const peers=await db.conversationMember.findMany({where:{conversation:{members:{some:{userId}}}},select:{userId:true}});
    return [...new Set([userId,...peers.map(p=>p.userId)])];
  }
  async function broadcastPresence(userId:string) {for(const peer of await audience(userId)) io.to(`user:${peer}`).emit('presence:update',{userId,online:counts.has(userId)});}
  io.use(async(socket,next)=> {try {
    if(socket.handshake.headers.origin && socket.handshake.headers.origin!==origin) throw new Error();
    const current=await session(socket.handshake.headers.cookie);if(!current) throw new Error();
    socket.data.current=current;next();
  }catch{next(new Error('Требуется вход'));}});
  io.on('connection',socket=> {
    const current=socket.data.current;const userId:string=current.userId;
    socket.join(`user:${userId}`);socket.join(`session:${current.tokenHash}`);
    counts.set(userId,(counts.get(userId)||0)+1);
    void broadcastPresence(userId).catch(()=>{});
    void audience(userId).then(peers=>socket.emit('presence:snapshot',peers.filter(id=>counts.has(id)))).catch(()=>{});
    const expiry=setTimeout(()=>socket.disconnect(true),Math.max(0,new Date(current.expiresAt).getTime()-Date.now()));
    function handle(event:string,fn:(data:any)=>Promise<unknown>) {
      socket.on(event,async(data,ack)=> {try {
        if(!await db.session.findFirst({where:{tokenHash:current.tokenHash,expiresAt:{gt:new Date()}}})) throw new HttpError(401,'Сессия истекла');
        const key=userId;const now=Date.now();let quota=socketRate.get(key);
        if(!quota||quota.until<now) {quota={count:0,until:now+10000};socketRate.set(key,quota);}
        if(++quota.count>60) throw new HttpError(429,'Слишком много событий');
        const result=await fn(data);if(typeof ack==='function') ack({ok:true,data:result});
      }catch(e){if(typeof ack==='function')ack({ok:false,error:e instanceof ZodError?'Некорректные данные':e instanceof HttpError?e.message:'Не удалось выполнить действие'});}});
    }
    handle('conversation:join',async data=> {const id=idSchema.parse(data?.conversationId);await membership(userId,id);await socket.join(`chat:${id}`);return {online:(await db.conversationMember.findMany({where:{conversationId:id}})).filter(m=>counts.has(m.userId)).map(m=>m.userId)};});
    handle('conversation:leave',async data=> {await socket.leave(`chat:${idSchema.parse(data?.conversationId)}`);});
    handle('message:send',async data=> {
      const message=await saveMessage(userId,data);
      const members=await db.conversationMember.findMany({where:{conversationId:message.conversationId}});
      for(const member of members) io.to(`user:${member.userId}`).emit('message:new',message);
      return message;
    });
    for(const event of ['typing:start','typing:stop']) handle(event,async data=> {
      const id=idSchema.parse(data?.conversationId);await membership(userId,id);
      const key=`${socket.id}:${id}`;const previous=typing.get(key);
      if(event==='typing:start' && previous) return;
      if(previous)clearTimeout(previous);typing.delete(key);
      const emit=(active:boolean)=>socket.to(`chat:${id}`).emit('typing:update',{conversationId:id,userId,active});
      emit(event==='typing:start');
      if(event==='typing:start') typing.set(key,setTimeout(()=>{typing.delete(key);emit(false);},2500));
    });
    socket.on('disconnect',()=> {
      clearTimeout(expiry);
      const count=(counts.get(userId)||1)-1;if(count)counts.set(userId,count);else{counts.delete(userId);socketRate.delete(userId);}
      void broadcastPresence(userId).catch(()=>{});
    });
  });
  const cleanup=setInterval(()=>{const now=Date.now();for(const [key,q] of socketRate)if(q.until<now)socketRate.delete(key);void db.session.deleteMany({where:{expiresAt:{lt:new Date()}}}).catch(()=>{});},60000);cleanup.unref();
  http.on('close',()=>{clearInterval(cleanup);for(const timer of typing.values())clearTimeout(timer);});
  app.use('/api',(_req,res)=>res.status(404).json({error:'Маршрут не найден'}));
  app.use(express.static('dist'));
  app.get('/{*path}',(_req,res)=>res.sendFile('index.html',{root:'dist'}));
  app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=> {
    const status=error instanceof ZodError?400:error instanceof HttpError?error.status:error.status===400?400:500;
    if(status===500)console.error('Request failed:',error.code || error.name);
    res.status(status).json({error:error instanceof ZodError?'Проверьте введённые данные':error instanceof HttpError?error.message:status===400?'Некорректный JSON':'Ошибка сервера'});
  });
  return {app,http,io};
}
