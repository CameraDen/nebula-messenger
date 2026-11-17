import { spawnSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const name=`test-${process.pid}-${Date.now()}.db`;
const env={...process.env,DATABASE_URL:`file:./${name}`};
let status=1;
try{
  const migration=spawnSync(process.execPath,['scripts/migrate.mjs'],{stdio:'inherit',env});
  if(migration.status===0)status=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run'],{stdio:'inherit',env}).status??1;
}finally{for(const suffix of ['', '-journal','-wal','-shm']){try{unlinkSync(resolve('prisma',name+suffix));}catch{}}}
process.exit(status);
