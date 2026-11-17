export type User={id:string;email:string;displayName:string};
export type Message={id:number;conversationId:string;senderId:string;body:string;createdAt:string;clientMessageId:string};
export type Conversation={id:string;updatedAt:string;members:{user:User;userId:string}[];messages:Message[]};
export type Page={messages:Message[];nextCursor:number|null};
