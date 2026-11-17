import { io, type Socket } from 'socket.io-client';
export const connect=()=>io({withCredentials:true,autoConnect:false});
export function emit<T>(socket:Socket,event:string,data:unknown):Promise<T> {
  return new Promise((resolve,reject)=>socket.timeout(8000).emit(event,data,(error:Error|null,response:{ok:boolean;data:T;error?:string})=> {
    if(error)reject(new Error('Нет подтверждения сервера. Можно повторить отправку.'));
    else if(!response.ok)reject(new Error(response.error));else resolve(response.data);
  }));
}
