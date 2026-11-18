import { expect } from 'vitest';
import { createApp } from '../src/app.ts';
import { officialBots } from '../src/bots/catalog.ts';
import { BotRuntime } from '../src/bots/runtime.ts';
import { Economy } from '../src/community/economy.ts';
import type { BotModule } from '../src/bots/types.ts';
import { Accounts } from '../src/community/auth.ts';
import { Community } from '../src/community/core.ts';
import { Hub, type GatewayEvent } from '../src/community/hub.ts';
import { loadConfig } from '../src/config.ts';
import { connectPglite } from '../src/db/db.ts';
import { migrate } from '../src/db/schema.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { FakeSfu } from './fake-sfu.ts';

/** Limitador que nunca recusa: os testes de regras não devem esbarrar em limite de requisições. */
export class Unlimited extends RateLimiter {
  override take(): boolean {
    return true;
  }
}

export const config = loadConfig({
  NODE_ENV: 'production',
  LIVEKIT_URL: 'wss://exemplo.livekit.cloud',
  LIVEKIT_API_KEY: 'chave',
  LIVEKIT_API_SECRET: 'segredo-do-livekit-123',
  APP_SECRET: 'segredo-do-app-para-testes',
  ALLOWED_ORIGINS: 'https://fulano.github.io',
});

export interface Person {
  id: string;
  token: string;
  name: string;
}

/** Um backend inteiro na memória: banco PostgreSQL de verdade (PGlite), SFU simulado e as rotas reais. */
export async function createWorld(limiter: RateLimiter = new Unlimited(), modules: BotModule[] = officialBots()) {
  const db = await connectPglite();
  await migrate(db);
  const hub = new Hub();
  const sfu = new FakeSfu();
  const accounts = new Accounts(db, { scryptCost: 10 });
  const community = new Community(db, hub, sfu, { livekitUrl: config.livekitUrl, tokenTtlSeconds: 600 }, limiter);
  /** Relógio dos bots: os testes adiantam o tempo em vez de esperar. */
  const clock = { now: new Date('2026-11-16T15:00:00.000Z') };
  const economy = new Economy(db, community, { now: () => clock.now, adminSecret: config.appSecret });
  const bots = new BotRuntime(db, community, modules, { now: () => clock.now, economy });
  const app = createApp({ config, sfu, limiter, groups: { accounts, community, bots, economy } });

  const api = async (method: string, path: string, token?: string | null, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as any };
  };

  const ok = async (method: string, path: string, token?: string | null, body?: unknown) => {
    const result = await api(method, path, token, body);
    expect(result.status, `${method} ${path} → ${JSON.stringify(result.json)}`).toBe(200);
    return result.json;
  };

  const signup = async (username: string): Promise<Person> => {
    const json = await ok('POST', '/api/auth/register', null, { username, password: 'senha-de-teste-1', displayName: username[0]!.toUpperCase() + username.slice(1) });
    return { id: json.user.id, token: json.token, name: username };
  };

  /** Conexão de tempo real simulada: guarda os eventos que a pessoa receberia. */
  const connect = async (person: Person) => {
    const events: GatewayEvent[] = [];
    const connection = hub.open(person.id, await community.groupIdsOf(person.id), {
      send: (text) => void events.push(JSON.parse(text) as GatewayEvent),
      close: () => undefined,
    });
    return { events, of: (type: string) => events.filter((event) => event.t === type), close: () => hub.close(connection) };
  };

  const group = async (owner: Person, name = 'Grupo de teste', extra: Record<string, unknown> = {}) => (await ok('POST', '/api/groups', owner.token, { name, ...extra })).group.id as string;
  const view = (person: Person, groupId: string) => ok('GET', `/api/groups/${groupId}`, person.token);

  /** Entra no grupo por um convite criado pelo dono. */
  const join = async (owner: Person, groupId: string, ...people: Person[]) => {
    const { invite } = await ok('POST', `/api/groups/${groupId}/invites`, owner.token, {});
    for (const person of people) await ok('POST', `/api/invites/${invite.code}/accept`, person.token);
  };

  const role = async (actor: Person, groupId: string, name: string, permissions: bigint) =>
    (await ok('POST', `/api/groups/${groupId}/roles`, actor.token, { name, permissions: permissions.toString() })).id as string;

  const give = (actor: Person, groupId: string, target: Person, roleIds: string[]) =>
    ok('PATCH', `/api/groups/${groupId}/members/${target.id}`, actor.token, { roleIds });

  /** Ordem dos cargos do mais alto para o mais baixo, pelos nomes. Os que não forem citados ficam por baixo. */
  const order = async (actor: Person, groupId: string, names: string[]) => {
    const state = await view(actor, groupId);
    const roles = (state.roles as { id: string; name: string; isEveryone: boolean }[]).filter((item) => !item.isEveryone);
    const first = names.map((name) => roles.find((item) => item.name === name)!.id);
    return ok('PUT', `/api/groups/${groupId}/roles/order`, actor.token, { order: [...first, ...roles.map((item) => item.id).filter((id) => !first.includes(id))] });
  };

  const channelByName = async (person: Person, groupId: string, name: string) =>
    ((await view(person, groupId)).channels as { id: string; name: string }[]).find((item) => item.name === name)?.id;

  /** Envia uma mensagem e espera os bots terminarem de reagir a ela. */
  const say = async (person: Person, channelId: string, content: string, stepMs = 3000) => {
    clock.now = new Date(clock.now.getTime() + stepMs);
    const result = await api('POST', `/api/channels/${channelId}/messages`, person.token, { content });
    await bots.idle();
    return result;
  };
  const texts = async (person: Person, channelId: string) => ((await ok('GET', `/api/channels/${channelId}/messages`, person.token)).messages as { content: string }[]).map((message) => message.content);

  return { db, hub, sfu, accounts, community, bots, economy, clock, app, api, ok, signup, connect, group, view, join, role, give, order, channelByName, say, texts };
}

export type World = Awaited<ReturnType<typeof createWorld>>;
