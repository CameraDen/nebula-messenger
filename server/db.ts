import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
process.env.DATABASE_URL ||= 'file:./dev.db';
export const db = new PrismaClient();
export const publicUser = { id:true, email:true, displayName:true } as const;
