import { Ban, Ellipsis, LogOut, MicOff, MonitorOff, MoveRight, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { has, P } from '../../../../shared/permissions.ts';
import { groups, type ChannelView, type GroupView } from '../../lib/groups/client.ts';
import { RoomSession, type ParticipantView, type SessionAccess } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { PersonVolume } from '../room/PersonVolume.tsx';
import { ParticipantsCard } from '../room/Sidebar.tsx';
import { CosmeticName, DecoratedAvatar } from '../cosmetics/Decoration.tsx';
import { Button, Card, IconButton, Menu, MenuItem, MenuLabel, Notice, Slider } from '../ui.tsx';
import { errorText, memberName, useAction } from './common.tsx';

export interface VoiceState {
  groupId: string;
  channelId: string;
  session: RoomSession;
}

/** Acesso a um canal de voz: o backend confere as permissões e devolve um token já limitado ao que a pessoa pode fazer. */
function voiceAccess(channelId: string): SessionAccess {
  return {
    persistentIdentities: true,
    async grant() {
      const grant = await groups.call('POST', `/api/channels/${channelId}/voice`, undefined, 70_000);
      return {
        url: grant.url,
        token: grant.token,
        identity: grant.identity,
        isHost: false,
        room: grant.room,
        rights: { speak: grant.speak, stream: grant.stream, streamAudio: grant.streamAudio, watch: grant.canWatch, highQuality: grant.highQuality },
      };
    },
  };
}

/**
 * Conexão de voz da página de grupos. Fica viva enquanto a pessoa navega pelos canais de texto e termina
 * quando ela sai do canal, fecha a página ou é tirada do canal.
 */
export function useVoice(view: GroupView | null) {
  const gatewayLive = useStore(groups.store, (state) => state.live);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const current = useRef<VoiceState | null>(null);
  const sequence = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const target = useRef<string | null>(null);
  const requestedLeave = useRef(false);

  const drop = useCallback(async (tellServer: boolean) => {
    const active = current.current;
    current.current = null;
    setVoice(null);
    if (active) await active.session.leave().catch(() => undefined);
    if (tellServer) await groups.call('POST', '/api/voice/leave').catch(() => undefined);
  }, []);

  const leave = useCallback(() => {
    sequence.current++;
    requestedLeave.current = true;
    target.current = null;
    setJoining(null);
    const active = current.current;
    current.current = null;
    setVoice(null);
    void active?.session.leave();
    const leaving = queue.current.then(async () => { await active?.session.leave(); await drop(true); });
    queue.current = leaving.catch(() => undefined);
    return leaving;
  }, [drop]);

  const join = useCallback(
    async (groupId: string, channelId: string) => {
      if (target.current === channelId || current.current?.channelId === channelId) return;
      const attempt = ++sequence.current;
      requestedLeave.current = false;
      target.current = channelId;
      setJoining(channelId);
      void current.current?.session.leave();
      const joining = queue.current.then(async () => {
        if (sequence.current !== attempt) return;
        await drop(false);
        if (sequence.current !== attempt) return;
        const session = new RoomSession();
        session.store.set({ roomName: groups.store.get().view?.channels.find(item => item.id === channelId)?.name ?? '' });
        const next = { groupId, channelId, session };
        current.current = next;
        setVoice(next);
        try {
          await session.join(voiceAccess(channelId));
          if (sequence.current !== attempt) await session.leave();
        } catch (error) {
          await session.leave().catch(() => undefined);
          if (sequence.current === attempt) {
            current.current = null; setVoice(null);
            await groups.call('POST', '/api/voice/leave').catch(() => undefined);
            groups.notify(errorText(error, 'Não foi possível entrar no canal de voz.'));
          }
        } finally {
          if (sequence.current === attempt) { target.current = null; setJoining(null); }
        }
      });
      queue.current = joining.catch(() => undefined);
      await joining;
    },
    [drop],
  );

  // O SFU confirma a presença após a conexão e após uma queda do gateway.
  useEffect(() => {
    if (!voice || !gatewayLive) return;
    const sync = () => {
      if (voice.session.store.get().phase === 'connected') void groups.call('POST', `/api/channels/${voice.channelId}/voice/sync`).catch(() => undefined);
    };
    sync();
    let phase = voice.session.store.get().phase;
    return voice.session.store.subscribe(() => {
      const next = voice.session.store.get().phase;
      if (next !== phase) { phase = next; if (next === 'connected') sync(); }
    });
  }, [voice, gatewayLive]);

  // A conexão terminou sozinha (rede caiu de vez, a pessoa foi tirada do canal, outra aba assumiu).
  useEffect(() => {
    if (!voice) return;
    return voice.session.store.subscribe(() => {
      if (voice.session.store.get().phase === 'ended' && current.current === voice && !target.current && !requestedLeave.current) void drop(true);
    });
  }, [voice, drop]);

  // Um moderador agiu sobre esta conta.
  useEffect(() => {
    groups.onVoiceSignal = (signal) => {
      const by = signal.by ? `${signal.by} ` : 'Um moderador ';
      if (signal.type === 'move') {
        groups.notify(`${by}moveu você para outro canal de voz.`);
        void join(signal.groupId, signal.channelId);
      } else if (signal.type === 'disconnected') {
        groups.notify(`${by}tirou você do canal de voz.`);
        void drop(false);
      } else if (signal.type === 'muted') {
        groups.notify(`${by}desligou o seu microfone.`);
      } else if (signal.type === 'stream_stopped') {
        groups.notify(`${by}encerrou a sua transmissão.`);
      }
    };
    return () => {
      groups.onVoiceSignal = null;
    };
  }, [join, drop]);

  // Permissões que mudam com a sala aberta: assistir transmissões e alta qualidade vêm do canal.
  useEffect(() => {
    if (!voice || !view || view.group.id !== voice.groupId) return;
    const channel = view.channels.find((item) => item.id === voice.channelId);
    if (!channel) {
      // O canal pode ainda não estar na lista (acesso recém-liberado, por exemplo ao ser movido para um canal
      // privado): o backend já deixou entrar. Confere com a lista atualizada antes de concluir que perdeu o acesso.
      let alive = true;
      void groups.refreshView().then(() => {
        const fresh = groups.store.get().view;
        if (!alive || current.current !== voice || !fresh || fresh.group.id !== voice.groupId) return;
        if (fresh.channels.some((item) => item.id === voice.channelId)) return;
        groups.notify('Você não tem mais acesso a este canal de voz.');
        void drop(true);
      });
      return () => {
        alive = false;
      };
    }
    voice.session.setViewRights({ watch: has(channel.permissions, P.WATCH_STREAMS), highQuality: has(channel.permissions, P.HIGH_QUALITY_STREAM) });
  }, [voice, view, drop]);

  // Saiu da página de grupos: a conexão de voz termina.
  useEffect(() => () => { void leave(); }, [leave]);

  return { voice, joining, join, leave };
}

/** Tela de um canal de voz em que a pessoa ainda não entrou. */
export function VoiceLobby({ view, channel, joining, onJoin }: { view: GroupView; channel: ChannelView; joining: boolean; onJoin: () => void }) {
  const inside = (view.voice[channel.id] ?? []).map((userId) => view.members.find((member) => member.userId === userId)).filter((member) => member !== undefined);
  const canConnect = has(channel.permissions, P.CONNECT);
  const full = channel.userLimit > 0 && inside.length >= channel.userLimit && !has(channel.permissions, P.MOVE_MEMBERS);
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="voice-lobby">
      <Card className="w-full max-w-md p-6 text-center">
        <Volume2 className="mx-auto size-10 text-brand-300" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-extrabold">{channel.name}</h1>
        <p className="mt-1 text-sm text-fog-400">
          Canal de voz{channel.userLimit > 0 ? ` • ${inside.length} de ${channel.userLimit} pessoas` : inside.length > 0 ? ` • ${inside.length} ${inside.length === 1 ? 'pessoa' : 'pessoas'}` : ' • vazio'}
        </p>
        {inside.length > 0 && (
          <ul className="mt-4 flex flex-wrap justify-center gap-3">
            {inside.map((member) => (
              <li key={member.userId} className="flex items-center gap-2 text-sm font-semibold">
                <DecoratedAvatar userId={member.userId} name={memberName(member)} size={28} online image={member.avatar} />
                <CosmeticName userId={member.userId}>{memberName(member)}</CosmeticName>
              </li>
            ))}
          </ul>
        )}
        {!canConnect && <Notice className="mt-5 text-left">Você pode ver este canal, mas não tem a permissão “Conectar” nele.</Notice>}
        {canConnect && full && <Notice className="mt-5 text-left">O canal está cheio.</Notice>}
        <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!canConnect || full || joining} onClick={onJoin} data-testid="voice-join">
          {joining ? 'Conectando…' : 'Entrar no canal de voz'}
        </Button>
        <p className="mt-3 text-xs leading-snug text-fog-500">O microfone volta como estava na sua última chamada. Você transmite a tela e ajusta o áudio depois de entrar.</p>
      </Card>
    </section>
  );
}

/** Participantes do canal de voz em que a pessoa está, com volume individual e as ações de moderação que ela pode usar. */
export function VoicePeople({ view, voice, className }: { view: GroupView; voice: VoiceState; className?: string }) {
  const channel = view.channels.find((item) => item.id === voice.channelId);
  const { run } = useAction();
  if (!channel) return null;
  const perms = channel.permissions;
  const others = view.channels.filter((item) => item.kind === 'voz' && item.id !== channel.id && has(item.permissions, P.CONNECT));
  const moderate = (person: ParticipantView, action: string, extra: object = {}) =>
    run(() => groups.call('POST', `/api/channels/${channel.id}/voice/moderate`, { userId: person.identity, action, ...extra }));

  return (
    <ParticipantsCard
      session={voice.session}
      serverNameEffects
      invite=""
      className={className}
      actions={(person) =>
        person.isLocal ? null : (
          <Menu
            side="bottom"
            align="end"
            trigger={({ toggle }) => (
              <IconButton label={`Opções de ${person.name}`} className="size-8" onClick={toggle} data-testid="voice-person-menu">
                <Ellipsis className="size-4" />
              </IconButton>
            )}
          >
            {(close) => {
              const act = (action: string, extra?: object) => {
                close();
                void moderate(person, action, extra);
              };
              return (
                <div className="w-64">
                  <MenuLabel>Volume da voz para você</MenuLabel>
                  <PersonVolume session={voice.session} volumeKey={`voz:${person.identity}`} name={person.name} className="px-2.5 pb-2" />
                  {has(perms, P.MUTE_MEMBERS) && (
                    <MenuItem icon={<MicOff className="size-4" />} onClick={() => act('mute')}>
                      Desligar o microfone
                    </MenuItem>
                  )}
                  {has(perms, P.BLOCK_SPEAK) && (
                    <>
                      <MenuItem icon={<Ban className="size-4" />} onClick={() => act('block')}>
                        Impedir de falar neste canal
                      </MenuItem>
                      <MenuItem icon={<Volume2 className="size-4" />} onClick={() => act('unblock')}>
                        Deixar falar de novo
                      </MenuItem>
                    </>
                  )}
                  {has(perms, P.STOP_STREAMS) && person.sharing && (
                    <MenuItem icon={<MonitorOff className="size-4" />} onClick={() => act('stop_stream')}>
                      Encerrar a transmissão
                    </MenuItem>
                  )}
                  {has(perms, P.MOVE_MEMBERS) && (
                    <>
                      {others.map((other) => (
                        <MenuItem key={other.id} icon={<MoveRight className="size-4" />} onClick={() => act('move', { toChannelId: other.id })}>
                          Mover para {other.name}
                        </MenuItem>
                      ))}
                      <MenuItem icon={<LogOut className="size-4" />} onClick={() => act('disconnect')}>
                        Tirar do canal de voz
                      </MenuItem>
                    </>
                  )}
                </div>
              );
            }}
          </Menu>
        )
      }
    />
  );
}
