import 'dotenv/config';
import { createApp } from './app';
import { db } from './db';
const {http,io}=createApp();
const port=Number(process.env.PORT||3001);
const host=process.env.HOST||'0.0.0.0';
http.listen(port, host, () => {
  console.log(`Nebula: ${process.env.APP_ORIGIN||`http://127.0.0.1:${port}`}`);
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>io.close(()=>{void db.$disconnect().then(()=>process.exit(0));}));
