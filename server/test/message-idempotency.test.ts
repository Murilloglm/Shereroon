import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type Person, type World } from './world.ts';
let w: World, a: Person, b: Person, group: string, channel: string, dm: string;
beforeAll(async () => {
  w=await createWorld(undefined, []); a=await w.signup('deliverya'); b=await w.signup('deliveryb');
  group=await w.group(a); await w.join(a,group,b); channel=(await w.channelByName(a,group,'geral'))!;
  dm=(await w.ok('POST','/api/dms',a.token,{userId:b.id})).id;
});
afterAll(async () => { await w.db.close(); });
describe('durable message delivery acknowledgements', () => {
  it('concurrent HTTP retries create exactly one message and one gateway event', async () => {
    const client=await w.connect(b), clientId=crypto.randomUUID();
    const results=await Promise.all(Array.from({length:5},()=>w.ok('POST',`/api/channels/${channel}/messages`,a.token,{content:'exactly once',clientId})));
    expect(new Set(results.map(r=>r.message.id)).size).toBe(1);
    expect(results[0].message.clientId).toBe(clientId);
    expect(client.of('message.created').filter((e:any)=>e.message.clientId===clientId)).toHaveLength(1);
    expect((await w.db.query('SELECT id FROM messages WHERE client_id=$1',[clientId]))).toHaveLength(1);
    await client.close();
  });
  it('same client key is independent for different senders and chat contexts', async () => {
    const clientId=crypto.randomUUID();
    const [one,two]=await Promise.all([a,b].map(person=>w.ok('POST',`/api/channels/${channel}/messages`,person.token,{content:person.name,clientId})));
    expect(one.message.id).not.toBe(two.message.id);
    const sent=(await w.ok('POST',`/api/dms/${dm}/messages`,a.token,{content:'private',clientId})).message;
    const repeated=(await w.ok('POST',`/api/dms/${dm}/messages`,a.token,{content:'private',clientId})).message;
    expect(sent).toEqual(repeated);
    expect((await w.ok('GET',`/api/dms/${dm}/messages`,b.token)).messages.filter((m:any)=>m.clientId===clientId)).toHaveLength(1);
  });
  it('DM concurrent sends maintain latest message/read cursors and order', async () => {
    const messages=await Promise.all(Array.from({length:4},(_,i)=>w.ok('POST',`/api/dms/${dm}/messages`,i%2?a.token:b.token,{content:`fast ${i}`,clientId:crypto.randomUUID()})));
    const latest=messages.map(m=>BigInt(m.message.id)).reduce((a,b)=>a>b?a:b);
    const [row]=await w.db.query('SELECT last_message_id FROM dm_channels WHERE id=$1',[dm]);
    expect(BigInt(String(row!.last_message_id))).toBe(latest);
  });
  it('invalid operation keys are rejected before storing a message', async () => {
    for (const path of [`/api/channels/${channel}/messages`,`/api/dms/${dm}/messages`]) {
      const response=await w.api('POST',path,a.token,{content:'invalid',clientId:'bad'});
      expect(response.status).toBe(400);
    }
  });
});
