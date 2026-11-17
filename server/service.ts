import { z } from 'zod';
import { db } from './db';
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export const idSchema = z.string().min(1).max(100);
export const messageSchema = z.object({conversationId:idSchema,body:z.string().trim().min(1).max(4000),clientMessageId:z.string().uuid()});
export async function membership(userId:string,conversationId:string) {
  const member = await db.conversationMember.findUnique({where:{conversationId_userId:{conversationId,userId}}});
  if(!member) throw new HttpError(403,'Нет доступа к диалогу');
}
export async function saveMessage(userId:string,input:unknown) {
  const data = messageSchema.parse(input);
  await membership(userId,data.conversationId);
  return db.$transaction(async tx => {
    const existing = await tx.message.findUnique({where:{senderId_clientMessageId:{senderId:userId,clientMessageId:data.clientMessageId}}});
    if(existing) {
      if(existing.conversationId!==data.conversationId || existing.body!==data.body) throw new HttpError(409,'Идентификатор уже использован');
      return existing;
    }
    const message = await tx.message.create({data:{...data,senderId:userId}});
    await tx.conversation.update({where:{id:data.conversationId},data:{updatedAt:message.createdAt}});
    return message;
  });
}
