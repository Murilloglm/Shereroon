import { describe, expect, it } from 'vitest';
import { mergeMessages, messageKey, type Delivery } from './outbox.ts';
const message=(id:string,clientId?:string,author='a')=>({id,clientId,author:{id:author},createdAt:'2026-11-18T00:00:00.000Z',content:id,...(id.startsWith('local:')?{delivery:'sending' as Delivery['delivery']}:{})});
describe('optimistic outbox reconciliation',()=>{
  it('HTTP then gateway and gateway then HTTP each produce one canonical row',()=>{
    const pending=message('local:nonce','nonce'), canonical=message('1','nonce');
    expect(mergeMessages(mergeMessages([pending],[canonical]),[canonical])).toEqual([{ ...canonical, delivery: 'sent' }]);
    expect(mergeMessages([canonical],[pending])).toEqual([canonical]);
    expect(messageKey(pending)).toBe(messageKey(canonical));
  });
  it('client IDs never merge other people and ordering handles bigint IDs',()=>{
    expect(mergeMessages([message('local:x','x')],[message('2','x','other')])).toHaveLength(2);
    expect(mergeMessages([message('9007199254740993'),message('local:p','p')],[message('9007199254740992')]).map(m=>m.id)).toEqual(['9007199254740992','9007199254740993','local:p']);
  });
  it('history refresh preserves pending/failed operations until acknowledgement',()=>{
    const pending={...message('local:p','p'),delivery:'failed' as const};
    expect(mergeMessages([pending],[message('2')])).toContain(pending);
    expect(mergeMessages([pending],[message('3','p')])).toEqual([{ ...message('3','p'), delivery: 'sent' }]);
  });
});
