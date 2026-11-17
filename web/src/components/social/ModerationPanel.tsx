import { Clock, Gavel, Hash, Image as ImageIcon, Link2, MessageSquare, MicOff, MoveRight, Paperclip, ShieldCheck, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { has, P, PERMISSIONS } from '../../../../shared/permissions.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { moveToVoice } from '../../lib/groups/actions.ts';
import { groups, type GroupView } from '../../lib/groups/client.ts';
import { Avatar, Button, cx, Modal } from '../ui.tsx';
import { errorText, memberName, selectClass } from '../groups/common.tsx';

interface Details {
  member: {
    userId: string;
    username: string;
    displayName: string;
    nickname: string | null;
    joinedAt: string;
    joinedVia: { kind: string; code: string | null; invitedBy: { id: string; name: string } | null } | null;
    timeoutUntil: string | null;
    roleIds: string[];
    bot: boolean;
    isOwner: boolean;
  };
  permissions: string;
  canAct: { kick: boolean; ban: boolean; timeout: boolean; roles: boolean; mute: boolean; move: boolean; audit: boolean };
  stats: { messages: number; links: number; images: number; files: number; channels: { channelId: string; name: string; messages: number }[] };
  history: { id: string; actorName: string; action: string; detail: Record<string, unknown>; createdAt: string }[] | null;
  voice: string | null;
}

const JOINED: Record<string, string> = { criador: 'Criou o grupo', convite: 'Por convite', publico: 'Grupo público', bot: 'Instalado como bot' };

const ACTIONS: Record<string, string> = {
  'membro.cargos': 'mudou os cargos',
  'membro.expulso': 'expulsou',
  'membro.banido': 'baniu',
  'membro.desbanido': 'desbaniu',
  'membro.castigo': 'mudou o castigo',
  'voz.silenciado': 'desligou o microfone',
  'voz.fala_bloqueada': 'impediu de falar',
  'voz.fala_liberada': 'deixou falar de novo',
  'voz.transmissao_encerrada': 'encerrou a transmissão',
  'voz.movido': 'moveu de canal',
  'voz.desconectado': 'tirou do canal de voz',
  'canal.acesso_concedido': 'liberou o acesso a um canal',
};

/**
 * Painel de moderação de um membro. Os dados vêm do backend já filtrados pelo que quem consulta pode ver
 * (estatísticas só deste grupo e dos canais visíveis, nada de mensagens privadas); as ações só aparecem se a
 * conta tem a permissão e está acima da pessoa na hierarquia, e o backend confere de novo.
 */
export function ModerationPanel({ view, userId, onClose }: { view: GroupView; userId: string; onClose: () => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const load = useCallback(
    () =>
      groups
        .call<Details>('GET', `/api/groups/${view.group.id}/members/${userId}/details`)
        .then((value) => {
          setDetails(value);
          setFailure(null);
        })
        .catch((error: unknown) => setFailure(errorText(error))),
    [view.group.id, userId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const member = view.members.find((item) => item.userId === userId);
  const name = member ? memberName(member) : (details?.member.displayName ?? 'Membro');
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      groups.notify(success);
      await load();
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não deu certo', message: errorText(error) });
    }
  };
  const permissions = details ? BigInt(details.permissions) : 0n;
  const granted = PERMISSIONS.filter((item) => has(permissions, P[item.key]));
  const manageable = view.roles.filter((role) => !role.isEveryone && !role.botId && (view.me.isOwner || role.position < (view.me.top ?? -1)));
  const voiceTargets = view.channels.filter((channel) => channel.kind === 'voz' && channel.id !== details?.voice && has(channel.permissions, P.CONNECT));

  return (
    <Modal title={`Moderação — ${name}`} onClose={onClose} wide>
      {!details ? (
        <p className="text-sm text-fog-400" data-testid="moderation-loading">{failure ?? 'Carregando…'}</p>
      ) : (
        <div className="grid gap-5" data-testid="moderation-panel">
          <section className="flex items-center gap-3">
            <Avatar id={userId} name={details.member.displayName} size={56} image={member?.avatar} />
            <div className="min-w-0">
              <p className="truncate text-lg font-extrabold">{name}</p>
              <p className="truncate text-sm text-fog-400">
                @{details.member.username} • ID <code className="text-xs">{userId}</code>
              </p>
            </div>
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            <Fact label="No grupo desde" value={new Date(details.member.joinedAt).toLocaleString('pt-BR')} />
            <Fact
              label="Como entrou"
              testId="moderation-joined"
              value={
                details.member.joinedVia
                  ? `${JOINED[details.member.joinedVia.kind] ?? details.member.joinedVia.kind}${details.member.joinedVia.code ? ` (${details.member.joinedVia.code})` : ''}${details.member.joinedVia.invitedBy ? ` — convite de ${details.member.joinedVia.invitedBy.name}` : ''}`
                  : 'Não registrado (entrou antes do registro existir)'
              }
            />
            {details.member.timeoutUntil && new Date(details.member.timeoutUntil) > new Date() && <Fact label="De castigo até" value={new Date(details.member.timeoutUntil).toLocaleString('pt-BR')} />}
            {details.voice && <Fact label="Na chamada" value={view.channels.find((channel) => channel.id === details.voice)?.name ?? 'canal de voz'} />}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-extrabold text-fog-300">Atividade neste grupo</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="moderation-stats">
              <Stat icon={<MessageSquare className="size-4" />} label="Mensagens" value={details.stats.messages} />
              <Stat icon={<Link2 className="size-4" />} label="Links" value={details.stats.links} />
              <Stat icon={<ImageIcon className="size-4" />} label="Imagens" value={details.stats.images} />
              <Stat icon={<Paperclip className="size-4" />} label="Arquivos" value={details.stats.files} />
            </div>
            {details.stats.channels.length > 0 && (
              <ul className="mt-2 grid gap-1 text-sm">
                {details.stats.channels.map((channel) => (
                  <li key={channel.channelId} className="flex items-center gap-2 text-fog-300">
                    <Hash className="size-3.5 text-fog-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    <span className="font-bold tabular-nums">{channel.messages}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-fog-500">Só canais que você enxerga. Mensagens privadas nunca entram nesta conta.</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-extrabold text-fog-300">Cargos e permissões efetivas</h3>
            <div className="flex flex-wrap gap-1.5">
              {manageable.length === 0 && view.roles.filter((role) => details.member.roleIds.includes(role.id)).length === 0 && <span className="text-sm text-fog-500">Sem cargos.</span>}
              {(details.canAct.roles ? manageable : view.roles.filter((role) => details.member.roleIds.includes(role.id))).map((role) => {
                const on = details.member.roleIds.includes(role.id);
                return (
                  <button
                    key={role.id}
                    type="button"
                    disabled={!details.canAct.roles}
                    aria-pressed={on}
                    onClick={() =>
                      void run(
                        () => groups.change('PATCH', `/api/groups/${view.group.id}/members/${userId}`, { roleIds: on ? details.member.roleIds.filter((id) => id !== role.id) : [...details.member.roleIds, role.id] }),
                        on ? `Cargo ${role.name} retirado.` : `Cargo ${role.name} dado.`,
                      )
                    }
                    className={cx('flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm font-semibold disabled:cursor-default', on ? 'border-brand-300 bg-brand-500/20' : 'border-ink-600 text-fog-400')}
                    data-testid="moderation-role"
                    data-role={role.name}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: role.color ?? 'var(--color-fog-500)' }} />
                    {role.name}
                  </button>
                );
              })}
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-fog-400">Permissões efetivas ({granted.length})</summary>
              <p className="mt-1.5 text-fog-300">{details.member.isOwner ? 'Dono do grupo: tem todas as permissões.' : granted.map((item) => item.name).join(', ') || 'Nenhuma.'}</p>
            </details>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-extrabold text-fog-300">Ações</h3>
            <div className="flex flex-wrap gap-2">
              {details.canAct.move && details.voice && (
                <div className="flex items-center gap-1.5">
                  <select className={cx(selectClass, 'h-9 w-44')} value={destination} onChange={(event) => setDestination(event.target.value)} aria-label="Canal de destino" data-testid="moderation-move-target">
                    <option value="">Mover para…</option>
                    {voiceTargets.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" disabled={!destination} onClick={() => void moveToVoice(view, details.voice!, userId, destination).then((done) => {
                      if (done) void load();
                    })} data-testid="moderation-move">
                    <MoveRight className="size-4" aria-hidden="true" /> Mover
                  </Button>
                </div>
              )}
              {details.canAct.mute && details.voice && (
                <Button size="sm" onClick={() => void run(() => groups.call('POST', `/api/channels/${details.voice}/voice/moderate`, { userId, action: 'mute' }), 'Microfone desligado.')} data-testid="moderation-mute">
                  <MicOff className="size-4" aria-hidden="true" /> Silenciar
                </Button>
              )}
              {details.canAct.timeout && (
                <select
                  className={cx(selectClass, 'h-9 w-40')}
                  value=""
                  aria-label="Aplicar castigo"
                  onChange={(event) => {
                    const minutes = Number(event.target.value);
                    void run(() => groups.change('POST', `/api/groups/${view.group.id}/members/${userId}/timeout`, { minutes }), minutes ? 'Castigo aplicado.' : 'Castigo retirado.');
                  }}
                  data-testid="moderation-timeout"
                >
                  <option value="">Castigo…</option>
                  <option value="10">10 minutos</option>
                  <option value="60">1 hora</option>
                  <option value="1440">1 dia</option>
                  <option value="10080">1 semana</option>
                  <option value="0">Tirar do castigo</option>
                </select>
              )}
              {details.canAct.kick && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    void dialogs
                      .confirm({ title: `Expulsar ${name}?`, message: 'A pessoa sai do grupo agora e pode voltar com um convite.', confirmLabel: 'Expulsar', tone: 'perigo', action: () => groups.change('POST', `/api/groups/${view.group.id}/members/${userId}/kick`, {}) })
                      .then((done) => done && onClose())
                  }
                  data-testid="moderation-kick"
                >
                  <UserX className="size-4" aria-hidden="true" /> Expulsar
                </Button>
              )}
              {details.canAct.ban && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    void dialogs
                      .prompt({ title: `Banir ${name}?`, message: 'A pessoa não volta nem com convite, até alguém desfazer o banimento.', label: 'Motivo (opcional, aparece na auditoria)', maxLength: 300, confirmLabel: 'Banir', tone: 'perigo', action: (reason) => groups.change('POST', `/api/groups/${view.group.id}/members/${userId}/ban`, { reason }) })
                      .then((reason) => reason !== null && onClose())
                  }
                  data-testid="moderation-ban"
                >
                  <Gavel className="size-4" aria-hidden="true" /> Banir
                </Button>
              )}
              {!Object.values(details.canAct).some(Boolean) && <p className="text-sm text-fog-500">Você pode ver estas informações, mas não pode agir sobre esta pessoa (hierarquia ou permissões).</p>}
            </div>
          </section>

          {details.history && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-fog-300">
                <ShieldCheck className="size-4" aria-hidden="true" /> Registros de moderação
              </h3>
              {details.history.length === 0 ? (
                <p className="text-sm text-fog-500">Nenhuma ação registrada.</p>
              ) : (
                <ul className="grid max-h-56 gap-1 overflow-y-auto text-sm" data-testid="moderation-history">
                  {details.history.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-800/40 px-2.5 py-1.5">
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-fog-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <b>{entry.actorName}</b> {ACTIONS[entry.action] ?? entry.action}
                        {typeof entry.detail.motivo === 'string' && entry.detail.motivo && <span className="text-fog-400"> — {entry.detail.motivo}</span>}
                      </span>
                      <time className="shrink-0 text-xs text-fog-500">{new Date(entry.createdAt).toLocaleString('pt-BR')}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2" data-testid={testId}>
      <p className="text-xs font-bold text-fog-500">{label}</p>
      <p className="text-sm text-fog-100">{value}</p>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-bold text-fog-500">
        <span className="text-neon-300">{icon}</span>
        {label}
      </p>
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
