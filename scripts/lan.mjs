import 'dotenv/config';
import {networkInterfaces} from 'node:os';
import {spawn} from 'node:child_process';
const candidates=Object.entries(networkInterfaces()).flatMap(([name,addresses])=>
  (addresses||[]).filter(a=>a.family==='IPv4'&&!a.internal).map(a=>({name,address:a.address}))
).filter(a=>! /vpn|xray|virtual|vethernet|wsl|docker|tailscale|radmin|tun|tap/i.test(a.name));
const score=a=>(/ethernet|wi-fi|wifi|eth|en\d|wlan/i.test(a.name)?100:0)+(/^192\.168\./.test(a.address)?30:/^10\./.test(a.address)?20:/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)?10:0);
candidates.sort((a,b)=>score(b)-score(a));
const address=process.env.LAN_IP||candidates[0]?.address;
if(!address){console.error('Не найден сетевой IPv4-адрес. Задайте LAN_IP в окружении.');process.exit(1);}
const port=process.env.PORT||'3001';
const origin=`http://${address}:${port}`;
if(process.env.NODE_ENV==='production'){console.error('Для lan требуется обычный HTTP-режим. Уберите NODE_ENV=production; production с Secure-cookie требует HTTPS.');process.exit(1);}
console.log(`\nАдрес для устройств вашей сети: ${origin}\nОставьте это окно открытым.\n`);
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{stdio:'inherit',env:{...process.env,HOST:'0.0.0.0',APP_ORIGIN:origin}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
