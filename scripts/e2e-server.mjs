import { spawnSync,spawn } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const name=`e2e-${process.pid}.db`;
const env={...process.env,DATABASE_URL:`file:./${name}`,PORT:'4173',HOST:'127.0.0.1',APP_ORIGIN:'http://nebula.test:4173'};
if(spawnSync(process.execPath,['scripts/migrate.mjs'],{env,stdio:'inherit'}).status!==0)process.exit(1);
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env,stdio:'inherit'});
function cleanup(){for(const suffix of ['','-journal','-wal','-shm'])try{unlinkSync(resolve('prisma',name+suffix));}catch{}}
child.on('exit',code=>{cleanup();process.exit(code??0);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{child.kill(signal);});
