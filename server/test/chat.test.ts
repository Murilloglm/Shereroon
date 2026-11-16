/**
 * Chat dos grupos: anexos, respostas, menções, reações, não lidas e notificações.
 * Tudo com pelo menos duas contas, pelas rotas reais, num PostgreSQL de verdade (PGlite) na memória.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { P } from '../../shared/permissions.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let ana: Person;
let beto: Person;
let caio: Person;
let groupId: string;
let geral: string;

beforeEach(async () => {
  w = await createWorld();
  [ana, beto, caio] = await Promise.all([w.signup('ana'), w.signup('beto'), w.signup('caio')]);
  groupId = await w.group(ana);
  await w.join(ana, groupId, beto);
  geral = (await w.channelByName(ana, groupId, 'geral'))!;
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

async function upload(person: Person, channelId: string, bytes: Uint8Array, name = 'foto.png', mime = 'image/png', query = '') {
  const response = await w.app.request(`/api/channels/${channelId}/files?name=${encodeURIComponent(name)}${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${person.token}`, 'content-type': mime, 'content-length': String(bytes.byteLength) },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  return { status: response.status, json: (await response.json()) as any };
}

async function download(person: Person, fileId: string) {
  const response = await w.app.request(`/api/files/${fileId}`, { headers: { authorization: `Bearer ${person.token}` } });
  return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
}

const send = (person: Person, channelId: string, body: Record<string, unknown>) => w.api('POST', `/api/channels/${channelId}/messages`, person.token, body);
const messages = async (person: Person, channelId: string) => (await w.ok('GET', `/api/channels/${channelId}/messages`, person.token)).messages as any[];
const deny = (channelId: string, roleId: string, permission: bigint) =>
  w.ok('PUT', `/api/channels/${channelId}/overrides/cargo/${roleId}`, ana.token, { allow: '0', deny: permission.toString() });
const everyone = async () => ((await w.view(ana, groupId)).roles as any[]).find((role) => role.isEveryone).id as string;

describe('anexos', () => {
  it('envia um arquivo junto da mensagem e o outro membro baixa os mesmos bytes', async () => {
    const sent = await upload(beto, geral, PNG, 'férias na praia.png', 'image/png', '&w=640&h=480');
    expect(sent.status).toBe(200);
    expect(sent.json.file).toMatchObject({ name: 'férias na praia.png', mime: 'image/png', size: PNG.byteLength, width: 640, height: 480 });

    const posted = await send(beto, geral, { content: 'olha isso', attachments: [sent.json.file.id] });
    expect(posted.status).toBe(200);
    expect(posted.json.message.attachments).toEqual([sent.json.file]);

    const [seen] = await messages(ana, geral);
    expect(seen.attachments).toHaveLength(1);
    const got = await download(ana, seen.attachments[0].id);
    expect(got.status).toBe(200);
    expect([...got.bytes]).toEqual([...PNG]);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('mensagem só com anexo é aceita; sem texto e sem anexo, não', async () => {
    const { json } = await upload(beto, geral, PNG);
    expect((await send(beto, geral, { content: '', attachments: [json.file.id] })).status).toBe(200);
    expect((await send(beto, geral, { content: '   ' })).json.error.code).toBe('mensagem_vazia');
  });

  it('arquivo que pode rodar no navegador nunca é servido para abrir na página', async () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const { json } = await upload(beto, geral, html, 'pagina.html', 'text/html');
    await send(beto, geral, { content: 'x', attachments: [json.file.id] });
    const got = await download(ana, json.file.id);
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(got.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(got.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('quem não é do grupo, ou não vê o canal, não baixa o arquivo', async () => {
    const privado = (await w.ok('POST', `/api/groups/${groupId}/channels`, ana.token, { kind: 'texto', name: 'diretoria' })).id as string;
    await deny(privado, await everyone(), P.VIEW_CHANNEL);
    const { json } = await upload(ana, privado, PNG);
    await send(ana, privado, { content: 'segredo', attachments: [json.file.id] });
    expect((await download(ana, json.file.id)).status).toBe(200);
    expect((await download(beto, json.file.id)).status).toBe(404);
    expect((await download(caio, json.file.id)).status).toBe(404);
    const anonymous = await w.app.request(`/api/files/${json.file.id}`);
    expect(anonymous.status).toBe(401);
  });

  it('sem a permissão "Anexar arquivos" o envio é recusado no servidor', async () => {
    await deny(geral, await everyone(), P.ATTACH_FILES);
    const refused = await upload(beto, geral, PNG);
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe('sem_permissao');
    expect((await upload(ana, geral, PNG)).status).toBe(200);
  });

  it('respeita o tamanho máximo, recusa arquivo vazio e limita anexos por mensagem', async () => {
    const big = new Uint8Array(w.community.limits.fileBytes + 1);
    expect((await upload(beto, geral, big, 'grande.bin', 'application/octet-stream')).status).toBe(413);
    expect((await upload(beto, geral, new Uint8Array(0))).json.error.code).toBe('arquivo_vazio');
    const ids: string[] = [];
    for (let index = 0; index < 11; index++) ids.push((await upload(beto, geral, PNG, `f${index}.png`)).json.file.id);
    expect((await send(beto, geral, { content: 'muitos', attachments: ids })).json.error.code).toBe('anexos_demais');
  });

  it('o grupo tem uma cota de armazenamento', async () => {
    w.community.limits.groupStorageBytes = PNG.byteLength * 2;
    expect((await upload(beto, geral, PNG, 'a.png')).status).toBe(200);
    expect((await upload(ana, geral, PNG, 'b.png')).status).toBe(200);
    const full = await upload(beto, geral, PNG, 'c.png');
    expect(full.status).toBe(413);
    expect(full.json.error.code).toBe('grupo_sem_espaco');
  });

  it('ninguém anexa o arquivo enviado por outra pessoa, nem o mesmo arquivo duas vezes', async () => {
    const { json } = await upload(beto, geral, PNG);
    expect((await send(ana, geral, { content: 'meu?', attachments: [json.file.id] })).json.error.code).toBe('anexo_invalido');
    expect((await send(beto, geral, { content: '1', attachments: [json.file.id] })).status).toBe(200);
    expect((await send(beto, geral, { content: '2', attachments: [json.file.id] })).json.error.code).toBe('anexo_invalido');
  });

  it('apagar a mensagem apaga o arquivo; arquivo nunca anexado some na limpeza', async () => {
    const attached = (await upload(beto, geral, PNG, 'a.png')).json.file.id as string;
    const orphan = (await upload(beto, geral, PNG, 'b.png')).json.file.id as string;
    const { json } = await send(beto, geral, { content: 'tchau', attachments: [attached] });
    await w.ok('DELETE', `/api/messages/${json.message.id}`, ana.token);
    expect((await download(ana, attached)).status).toBe(404);
    expect((await download(beto, orphan)).status).toBe(200);
    expect(await w.community.purgeOrphanFiles(new Date(Date.now() + 2 * 60 * 60_000))).toBe(1);
    expect((await download(beto, orphan)).status).toBe(404);
  });
});

describe('respostas e menções', () => {
  it('a resposta carrega um resumo da mensagem original e avisa o autor dela', async () => {
    const first = (await send(ana, geral, { content: 'alguém joga hoje?' })).json.message;
    const reply = (await send(beto, geral, { content: 'eu!', replyTo: first.id })).json.message;
    expect(reply.reply).toEqual({ id: first.id, authorId: ana.id, authorName: 'Ana', excerpt: 'alguém joga hoje?' });
    expect(reply.mentions).toEqual([ana.id]);
    const seen = (await messages(ana, geral)).at(-1);
    expect(seen.reply.id).toBe(first.id);
  });

  it('não dá para responder a uma mensagem de outro canal; a original apagada some da resposta', async () => {
    const outro = (await w.ok('POST', `/api/groups/${groupId}/channels`, ana.token, { kind: 'texto', name: 'outro' })).id as string;
    const there = (await send(ana, outro, { content: 'lá' })).json.message;
    expect((await send(beto, geral, { content: 'aqui', replyTo: there.id })).json.error.code).toBe('resposta_invalida');

    const first = (await send(ana, geral, { content: 'vou apagar' })).json.message;
    await send(beto, geral, { content: 'ok', replyTo: first.id });
    await w.ok('DELETE', `/api/messages/${first.id}`, ana.token);
    expect((await messages(beto, geral)).at(-1).reply).toBeNull();
  });

  it('@usuario vira menção só para quem é membro do grupo', async () => {
    const { message } = (await send(ana, geral, { content: 'oi @beto, chama o @caio e o @ninguem. Valeu @Beto.' })).json;
    expect(message.mentions).toEqual([beto.id]);
    expect((await send(ana, geral, { content: 'email fulano@beto.com não é menção' })).json.message.mentions).toEqual([]);
  });
});

describe('reações', () => {
  it('reagir e tirar a reação aparece para todos em tempo real', async () => {
    const live = await w.connect(ana);
    const { message } = (await send(ana, geral, { content: 'bora?' })).json;
    const reacted = await w.ok('PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, beto.token);
    expect(reacted.message.reactions).toEqual([{ emoji: '👍', users: [beto.id] }]);
    await w.ok('PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, ana.token);
    await w.ok('PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('❤️')}`, ana.token);
    expect((await messages(beto, geral))[0].reactions).toEqual([
      { emoji: '👍', users: [beto.id, ana.id] },
      { emoji: '❤️', users: [ana.id] },
    ]);
    expect(live.of('message.updated').length).toBe(3);

    const removed = await w.ok('DELETE', `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, beto.token);
    expect(removed.message.reactions[0]).toEqual({ emoji: '👍', users: [ana.id] });
  });

  it('reagir duas vezes com o mesmo emoji conta uma vez; texto comum não é emoji', async () => {
    const { message } = (await send(ana, geral, { content: 'x' })).json;
    const path = `/api/messages/${message.id}/reactions/${encodeURIComponent('🎉')}`;
    await w.ok('PUT', path, beto.token);
    expect((await w.ok('PUT', path, beto.token)).message.reactions).toEqual([{ emoji: '🎉', users: [beto.id] }]);
    expect((await w.api('PUT', `/api/messages/${message.id}/reactions/abc`, beto.token)).json.error.code).toBe('emoji_invalido');
    expect((await w.api('PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('<b>')}`, beto.token)).status).toBe(400);
  });

  it('sem a permissão "Adicionar reações" no canal, o servidor recusa; quem não vê o canal nem encontra a mensagem', async () => {
    const { message } = (await send(ana, geral, { content: 'x' })).json;
    await deny(geral, await everyone(), P.ADD_REACTIONS);
    expect((await w.api('PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, beto.token)).status).toBe(403);
    expect((await w.api('PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, caio.token)).status).toBe(404);
  });
});

describe('mensagens não lidas', () => {
  const unreadOf = async (person: Person) => (await w.view(person, groupId)).unread[geral] as { last: string | null; read: string | null; mentions: number };
  const rail = async (person: Person) => ((await w.ok('GET', '/api/groups', person.token)).groups as any[]).find((group) => group.id === groupId);

  it('o canal fica não lido para quem não escreveu, até a pessoa marcar como lido', async () => {
    const { message } = (await send(ana, geral, { content: 'novidade' })).json;
    expect(await unreadOf(ana)).toMatchObject({ last: message.id, read: message.id });
    const before = await unreadOf(beto);
    expect(before.last).toBe(message.id);
    expect(Number(before.read ?? 0)).toBeLessThan(Number(message.id));
    expect((await rail(beto)).unread).toBe(true);
    expect((await rail(ana)).unread).toBe(false);

    await w.ok('POST', `/api/channels/${geral}/read`, beto.token, { messageId: message.id });
    expect((await unreadOf(beto)).read).toBe(message.id);
    expect((await rail(beto)).unread).toBe(false);
    // Marcar como lido nunca volta atrás.
    await w.ok('POST', `/api/channels/${geral}/read`, beto.token, { messageId: '1' });
    expect((await unreadOf(beto)).read).toBe(message.id);
  });

  it('conta as menções pendentes (diretas e @everyone) e zera ao ler', async () => {
    await send(ana, geral, { content: 'oi @beto' });
    await send(ana, geral, { content: '@everyone reunião' });
    const last = (await send(ana, geral, { content: 'sem menção' })).json.message;
    expect((await unreadOf(beto)).mentions).toBe(2);
    expect((await rail(beto)).mentions).toBe(2);
    await w.ok('POST', `/api/channels/${geral}/read`, beto.token, { messageId: last.id });
    expect((await unreadOf(beto)).mentions).toBe(0);
  });

  it('quem acabou de entrar não herda o histórico como não lido', async () => {
    await send(ana, geral, { content: 'antiga @everyone' });
    await w.join(ana, groupId, caio);
    expect((await rail(caio)).unread).toBe(false);
    expect((await w.view(caio, groupId)).unread[geral].mentions).toBe(0);
    await send(ana, geral, { content: 'nova' });
    expect((await rail(caio)).unread).toBe(true);
  });

  it('canal que a pessoa não vê não conta como não lido', async () => {
    const privado = (await w.ok('POST', `/api/groups/${groupId}/channels`, ana.token, { kind: 'texto', name: 'diretoria' })).id as string;
    await deny(privado, await everyone(), P.VIEW_CHANNEL);
    await send(ana, privado, { content: '@everyone só a diretoria' });
    expect((await rail(beto)).unread).toBe(false);
    expect((await w.view(beto, groupId)).unread[privado]).toBeUndefined();
  });
});

describe('notificações configuráveis', () => {
  const notify = async (person: Person) => (await w.view(person, groupId)).notify as { level: string; channels: Record<string, string> };

  it('cada pessoa escolhe o nível do grupo e de cada canal, guardado no servidor', async () => {
    expect(await notify(beto)).toEqual({ level: 'tudo', channels: {} });
    await w.ok('PUT', `/api/groups/${groupId}/notify`, beto.token, { level: 'mencoes' });
    await w.ok('PUT', `/api/groups/${groupId}/notify`, beto.token, { channelId: geral, level: 'nada' });
    expect(await notify(beto)).toEqual({ level: 'mencoes', channels: { [geral]: 'nada' } });
    expect(await notify(ana)).toEqual({ level: 'tudo', channels: {} });
    // Voltar o canal para "seguir o grupo".
    await w.ok('PUT', `/api/groups/${groupId}/notify`, beto.token, { channelId: geral, level: null });
    expect((await notify(beto)).channels).toEqual({});
  });

  it('canal silenciado não acende o grupo; com "só menções", só a menção acende', async () => {
    const rail = async () => ((await w.ok('GET', '/api/groups', beto.token)).groups as any[]).find((group) => group.id === groupId);
    await w.ok('PUT', `/api/groups/${groupId}/notify`, beto.token, { channelId: geral, level: 'nada' });
    await send(ana, geral, { content: 'oi @beto' });
    expect(await rail()).toMatchObject({ unread: false, mentions: 0 });

    await w.ok('PUT', `/api/groups/${groupId}/notify`, beto.token, { channelId: geral, level: 'mencoes' });
    expect(await rail()).toMatchObject({ unread: true, mentions: 1 });
  });

  it('recusa nível desconhecido e canal de outro grupo', async () => {
    expect((await w.api('PUT', `/api/groups/${groupId}/notify`, beto.token, { level: 'gritar' })).status).toBe(400);
    const other = await w.group(caio, 'Outro');
    const foreign = (await w.channelByName(caio, other, 'geral'))!;
    expect((await w.api('PUT', `/api/groups/${groupId}/notify`, beto.token, { channelId: foreign, level: 'nada' })).status).toBe(404);
  });
});
