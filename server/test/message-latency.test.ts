import { it, expect } from 'vitest';
import type { Db } from '../src/db/db.ts';
import { createWorld } from './world.ts';
it('measures local warm message commit and delivery latency (not Render/network)', async () => {
  const w = await createWorld(undefined, []);
  try {
    const a = await w.signup('latencya'), b = await w.signup('latencyb');
    const group = await w.group(a); await w.join(a, group, b);
    const channel = (await w.channelByName(a, group, 'geral'))!;
    const receiver = await w.connect(b); await w.connect(a);
    const dm = (await w.ok('POST', '/api/dms', a.token, { userId: b.id })).id;
    let queries = 0, dbMs = 0;
    const query = w.db.query.bind(w.db), tx = w.db.tx.bind(w.db);
    const wrap = (db: Db): Db => ({ ...db, query: async (...args) => { const start=performance.now(); queries++; try { return await db.query(...args); } finally { dbMs+=performance.now()-start; } } });
    w.db.query = async (...args) => { const start=performance.now(); queries++; try { return await query(...args); } finally { dbMs+=performance.now()-start; } };
    w.db.tx = run => tx(db => run(wrap(db)));
    for (const [kind,path] of [['group',`/api/channels/${channel}/messages`],['dm',`/api/dms/${dm}/messages`]]) {
      const samples: number[]=[], delivered: number[]=[], counts: number[]=[], database: number[]=[];
      for (let i=0;i<10;i++) {
        queries=0; dbMs=0; const start=performance.now();
        const {message}=await w.ok('POST', path!, a.token, { content:`benchmark-${kind}-${i}` });
        samples.push(performance.now()-start); counts.push(queries); database.push(dbMs);
        expect(receiver.events.some((event: any) => event.message?.id===message.id && (kind==='group'? event.t==='message.created': event.t==='dm.message'))).toBe(true);
        delivered.push(performance.now()-start);
      }
      const median=(x:number[])=>x.slice(2).sort((a,b)=>a-b)[4]!.toFixed(2);
      console.log(`message-latency ${process.env.LATENCY_LABEL??'current'} ${kind}: API median=${median(samples)}ms; recipient delivered<=${median(delivered)}ms; DB cumulative median=${median(database)}ms; queries=${median(counts)}; warm PGlite, two accounts, in-process HTTP`);
    }
  } finally { await w.db.close(); }
}, 30_000);
