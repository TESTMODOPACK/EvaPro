'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlanGate } from '@/components/PlanGate';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import MagicAgendaCard from '@/components/feedback/MagicAgendaCard';
import AiSuggestionsCard, { type AiSuggestion } from '@/components/feedback/AiSuggestionsCard';
import CheckInCompletionModal from '@/components/feedback/CheckInCompletionModal';
import {
  useCheckIns,
  useCheckInAgenda,
  useGenerateMagicAgenda,
  usePatchMagicAgenda,
  useAddTopicToCheckIn,
} from '@/hooks/useFeedback';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dateOnly = d.length > 10 ? d.slice(0, 10) : d;
  const parts = dateOnly.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function userName(u?: { firstName?: string; lastName?: string } | null): string {
  if (!u) return '—';
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—';
}

function AgendaPageContent() {
  const params = useParams();
  const router = useRouter();
  const toast = useToastStore();
  const { user } = useAuthStore();
  const role = user?.role || '';
  const currentUserId = user?.userId || '';

  const checkinId = typeof params?.checkinId === 'string' ? params.checkinId : '';

  const { data: checkIns, isLoading: loadingCheckIns } = useCheckIns();
  const { data: agendaData, isLoading: loadingAgenda, refetch } = useCheckInAgenda(checkinId);
  const generate = useGenerateMagicAgenda();
  const patch = usePatchMagicAgenda();
  const addTopic = useAddTopicToCheckIn();

  const [completionOpen, setCompletionOpen] = useState(false);
  const [newTopicText, setNewTopicText] = useState('');

  const checkin = useMemo(
    () => (checkIns || []).find((ci: any) => ci.id === checkinId),
    [checkIns, checkinId],
  );

  const isManager = checkin?.managerId === currentUserId;
  const isEmployee = checkin?.employeeId === currentUserId;
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const canGenerate = isAdmin || (role === 'manager' && isManager);
  const isCompleted = checkin?.status === 'completed';
  const isCancelled = checkin?.status === 'cancelled' || checkin?.status === 'rejected';
  const isScheduled = checkin?.status === 'scheduled';
  // Solo participantes (manager dueño o employee asignado) pueden proponer
  // temas — el backend rechaza con 403 a cualquier otro, incluyendo admins.
  // Es deliberado: el tema se atribuye a "quien lo propuso", admin no debe
  // impostar un tema del usuario.
  const canProposeTopic = isScheduled && (isManager || isEmployee);

  const handleAddTopic = () => {
    const text = newTopicText.trim();
    if (!text) return;
    addTopic.mutate(
      { id: checkinId, text },
      {
        onSuccess: () => {
          toast.success('Tema propuesto para el 1:1.');
          setNewTopicText('');
        },
        onError: (err: any) => {
          toast.error(err?.message || 'Error al proponer el tema.');
        },
      },
    );
  };

  const magicAgenda = agendaData?.magicAgenda;
  const carriedOver = agendaData?.carriedOverActionItems || [];

  // "Pendientes": combina carriedOverActionItems + magicAgenda.pendingFromPrevious
  // deduplicando por texto normalizado.
  const pendingCombined = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{
      text: string;
      assigneeName?: string;
      dueDate?: string | null;
      previousCheckinDate?: string;
      previousCheckinId?: string;
    }> = [];
    for (const it of carriedOver) {
      const key = it.text.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text: it.text,
        assigneeName: it.assigneeName,
        dueDate: it.dueDate || null,
        previousCheckinDate: it.previousCheckinDate,
        previousCheckinId: it.previousCheckinId,
      });
    }
    for (const p of magicAgenda?.pendingFromPrevious || []) {
      const key = p.text.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text: p.text,
        assigneeName: p.addedByName,
        previousCheckinId: p.previousCheckinId,
      });
    }
    return out;
  }, [carriedOver, magicAgenda]);

  const hasAi = !!agendaData?.hasAi;
  const neverGenerated = !magicAgenda;

  const handleGenerate = (force: boolean) => {
    if (!canGenerate) {
      toast.error('Solo el manager del check-in o un admin puede generar la agenda.');
      return;
    }
    generate.mutate(
      { checkinId, force },
      {
        onSuccess: () => {
          toast.success(force ? 'Agenda regenerada con éxito.' : 'Agenda generada con éxito.');
          refetch();
        },
        onError: (err: any) => {
          toast.error(err?.message || 'Error al generar la agenda.');
        },
      },
    );
  };

  const handleDismissSuggestion = (id: string) => {
    if (!canGenerate) return;
    const existing = (magicAgenda?.aiSuggestedTopics || [])
      .filter((t) => t.dismissed)
      .map((t) => t.id);
    patch.mutate(
      { checkinId, dismissedSuggestionIds: [...existing, id] },
      {
        onError: (err: any) => {
          toast.error(err?.message || 'Error al descartar sugerencia.');
        },
      },
    );
  };

  // ─── Loading / error / gated states ────────────────────────────────────

  if (loadingCheckIns || loadingAgenda) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px', margin: '0 auto' }}>
        <LoadingState fullHeight message="Cargando agenda del check-in…" />
      </div>
    );
  }

  if (!checkin) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '800px', margin: '0 auto' }}>
        <div className="card">
          <EmptyState
            icon="🔎"
            title="Check-in no encontrado"
            description="El check-in no existe o no tienes permisos para verlo."
            ctaLabel="Volver a feedback"
            ctaHref="/dashboard/feedback"
          />
        </div>
      </div>
    );
  }

  const employeeName = userName(checkin.employee);
  const managerName = userName(checkin.manager);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Breadcrumb / Back */}
      <div style={{ marginBottom: '1rem' }}>
        <Link
          href="/dashboard/feedback"
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          ← Volver a Check-ins
        </Link>
      </div>

      {/* Header */}
      <div
        className="animate-fade-up"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: '280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
            <span style={{ fontSize: '1.6rem', lineHeight: 1 }} aria-hidden>
              ✨
            </span>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>
              Agenda Mágica
            </h1>
            {isCompleted && (
              <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>
                Completado
              </span>
            )}
            {isCancelled && (
              <span className="badge badge-danger" style={{ fontSize: '0.72rem' }}>
                {checkin.status === 'rejected' ? 'Rechazado' : 'Anulado'}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            <strong>{checkin.topic}</strong>
          </p>
          <div
            style={{
              marginTop: '0.35rem',
              display: 'flex',
              gap: '1rem',
              flexWrap: 'wrap',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
            }}
          >
            <span>📅 {formatDate(checkin.scheduledDate)}{checkin.scheduledTime ? ` · ${String(checkin.scheduledTime).slice(0, 5)}` : ''}</span>
            <span>👤 {employeeName}</span>
            <span>👥 Encargado: {managerName}</span>
            {checkin.location && (
              <span>
                {checkin.location.type === 'virtual' ? '💻' : '🏢'} {checkin.location.name}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {canGenerate && !isCompleted && !isCancelled && (
            <>
              {neverGenerated ? (
                <button
                  className="btn-primary"
                  onClick={() => handleGenerate(false)}
                  disabled={generate.isPending}
                >
                  {generate.isPending ? 'Generando…' : '✨ Generar agenda'}
                </button>
              ) : (
                <button
                  className="btn-ghost"
                  onClick={() => handleGenerate(true)}
                  disabled={generate.isPending}
                  style={{ fontSize: '0.82rem' }}
                >
                  {generate.isPending ? 'Regenerando…' : '↻ Regenerar agenda'}
                </button>
              )}
            </>
          )}
          {canGenerate && !isCompleted && !isCancelled && !neverGenerated && (
            <button
              className="btn-primary"
              onClick={() => setCompletionOpen(true)}
              style={{ fontSize: '0.85rem' }}
            >
              ▶ Iniciar 1:1
            </button>
          )}
        </div>
      </div>

      {/* If never generated and user isn't allowed to generate, show empty state. */}
      {neverGenerated && !canGenerate && (
        <div className="card">
          <EmptyState
            icon="✨"
            title="La agenda aún no fue preparada"
            description="Cuando el encargado la genere, verás los pendientes anteriores, OKRs en curso, feedback reciente y reconocimientos."
            ctaLabel="Volver a Check-ins"
            ctaHref="/dashboard/feedback"
          />
        </div>
      )}

      {/* If never generated but user can → show big CTA */}
      {neverGenerated && canGenerate && !isCompleted && !isCancelled && (
        <div className="card" style={{ padding: '2rem' }}>
          <EmptyState
            icon="✨"
            title="Prepara la agenda en 3 segundos"
            description="Eva360 consolidará pendientes del 1:1 anterior, OKRs activos, feedback y reconocimientos recientes — y la IA sugerirá temas específicos a conversar."
            ctaLabel={generate.isPending ? 'Generando…' : '✨ Generar agenda'}
            ctaOnClick={() => handleGenerate(false)}
          />
        </div>
      )}

      {/* Grid con las cards */}
      {magicAgenda && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          {/* 1. Pendientes del anterior */}
          <MagicAgendaCard
            icon="📋"
            title="Pendientes del 1:1 anterior"
            count={pendingCombined.length}
            items={pendingCombined}
            accentColor="#f59e0b"
            emptyIcon="✅"
            emptyTitle="Sin pendientes"
            emptyHint="El 1:1 anterior quedó cerrado sin compromisos abiertos."
            renderItem={(item) => (
              <div
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: 'var(--radius-sm, 6px)',
                  background: 'rgba(245,158,11,0.06)',
                  border: '1px solid rgba(245,158,11,0.15)',
                  fontSize: '0.82rem',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.text}</div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginTop: '0.2rem',
                    display: 'flex',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {item.assigneeName && <span>— {item.assigneeName}</span>}
                  {item.dueDate && <span>Vence: {formatDate(item.dueDate)}</span>}
                  {item.previousCheckinDate && (
                    <span>1:1 del {formatDate(item.previousCheckinDate)}</span>
                  )}
                </div>
              </div>
            )}
          />

          {/* 2. OKRs activos */}
          <MagicAgendaCard
            icon="🎯"
            title="OKRs activos"
            count={magicAgenda.okrSnapshot.length}
            items={magicAgenda.okrSnapshot}
            accentColor="#10b981"
            emptyIcon="🎯"
            emptyTitle="Sin OKRs activos"
            emptyHint="El colaborador no tiene objetivos en curso."
            renderItem={(o) => {
              const progress = typeof o.progress === 'number' ? o.progress : 0;
              const daysBadge =
                o.daysToTarget == null
                  ? null
                  : o.daysToTarget < 0
                    ? { text: `Vencido hace ${Math.abs(o.daysToTarget)}d`, color: '#dc2626' }
                    : o.daysToTarget <= 7
                      ? { text: `Vence en ${o.daysToTarget}d`, color: '#d97706' }
                      : { text: `Vence en ${o.daysToTarget}d`, color: 'var(--text-muted)' };
              return (
                <div style={{ fontSize: '0.82rem', lineHeight: 1.4 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      justifyContent: 'space-between',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={o.title}
                    >
                      {o.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {progress}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: '5px',
                      background: 'rgba(16,185,129,0.12)',
                      borderRadius: '999px',
                      overflow: 'hidden',
                      marginBottom: daysBadge ? '0.3rem' : 0,
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max(0, Math.min(100, progress))}%`,
                        background: progress >= 100 ? '#10b981' : progress >= 50 ? '#22c55e' : '#f59e0b',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  {daysBadge && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        color: daysBadge.color,
                        fontWeight: 600,
                      }}
                    >
                      {daysBadge.text}
                    </span>
                  )}
                </div>
              );
            }}
          />

          {/* 3. Feedback reciente */}
          <MagicAgendaCard
            icon="💬"
            title="Feedback reciente"
            subtitle="Últimas 4 semanas"
            count={magicAgenda.recentFeedback.length}
            items={magicAgenda.recentFeedback}
            accentColor="#3b82f6"
            emptyIcon="💬"
            emptyTitle="Sin feedback reciente"
            emptyHint="Nadie le ha dado feedback en las últimas 4 semanas."
            renderItem={(f) => {
              const sentColor =
                f.sentiment === 'positive'
                  ? { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', text: '#059669', icon: '↑' }
                  : f.sentiment === 'constructive'
                    ? { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', text: '#d97706', icon: '↗' }
                    : { bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)', text: '#6b7280', icon: '~' };
              return (
                <div
                  style={{
                    padding: '0.55rem 0.7rem',
                    borderRadius: 'var(--radius-sm, 6px)',
                    background: sentColor.bg,
                    border: `1px solid ${sentColor.border}`,
                    fontSize: '0.8rem',
                    lineHeight: 1.4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.4rem',
                      alignItems: 'center',
                      marginBottom: '0.2rem',
                    }}
                  >
                    <span style={{ color: sentColor.text, fontWeight: 700 }} aria-hidden>
                      {sentColor.icon}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {f.fromName || 'Alguien'} · {formatDate(f.createdAt)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-primary)' }}>{f.messagePreview}</div>
                </div>
              );
            }}
          />

          {/* 4. Reconocimientos recientes */}
          <MagicAgendaCard
            icon="🏆"
            title="Reconocimientos recibidos"
            subtitle="Últimas 4 semanas"
            count={magicAgenda.recentRecognitions.length}
            items={magicAgenda.recentRecognitions}
            accentColor="#a855f7"
            emptyIcon="🏆"
            emptyTitle="Sin reconocimientos"
            emptyHint="No ha recibido reconocimientos recientes."
            renderItem={(r) => (
              <div
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: 'var(--radius-sm, 6px)',
                  background: 'rgba(168,85,247,0.06)',
                  border: '1px solid rgba(168,85,247,0.15)',
                  fontSize: '0.8rem',
                  lineHeight: 1.4,
                }}
              >
                {r.valueName && (
                  <div
                    style={{
                      display: 'inline-block',
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.45rem',
                      borderRadius: '999px',
                      background: 'rgba(168,85,247,0.12)',
                      color: '#7c3aed',
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em',
                      marginBottom: '0.25rem',
                    }}
                  >
                    {r.valueName}
                  </div>
                )}
                <div style={{ color: 'var(--text-primary)' }}>{r.messagePreview}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  {formatDate(r.createdAt)}
                </div>
              </div>
            )}
          />

          {/* 5. Sugerencias IA (variante especial) */}
          <div style={{ gridColumn: 'span 1' }}>
            <AiSuggestionsCard
              suggestions={(magicAgenda.aiSuggestedTopics || []) as AiSuggestion[]}
              hasAi={hasAi}
              onRegenerate={canGenerate && !isCompleted && !isCancelled ? () => handleGenerate(true) : undefined}
              onDismiss={canGenerate && !isCompleted && !isCancelled ? handleDismissSuggestion : undefined}
              isRegenerating={generate.isPending}
              generatedAt={magicAgenda.generatedAt}
            />
          </div>
        </div>
      )}

      {/* Agenda editable (temas adicionales ingresados manualmente).
          Se muestra si el check-in está scheduled (aunque no haya magicAgenda
          generada) o si hay temas ya registrados que merecen verse. */}
      {(canProposeTopic || (checkin.agendaTopics && checkin.agendaTopics.length > 0)) && (
        <div
          className="card animate-fade-up"
          style={{ padding: '1.15rem 1.25rem', marginBottom: '1.5rem' }}
        >
          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.88rem', fontWeight: 700 }}>
            📝 Temas propuestos por el equipo
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: '0.76rem',
              color: 'var(--text-muted)',
              marginBottom: '0.7rem',
            }}
          >
            {checkin.agendaTopics && checkin.agendaTopics.length > 0
              ? 'Temas que tú o el colaborador quieren conversar en este 1:1.'
              : 'Aún nadie propuso un tema. Agrega los tuyos abajo.'}
          </p>
          {checkin.agendaTopics && checkin.agendaTopics.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
              {checkin.agendaTopics.map((topic: any, idx: number) => (
                <li
                  key={idx}
                  style={{
                    padding: '0.5rem 0.7rem',
                    borderRadius: 'var(--radius-sm, 6px)',
                    background: 'rgba(99,102,241,0.04)',
                    border: '1px solid rgba(99,102,241,0.1)',
                    marginBottom: '0.4rem',
                    fontSize: '0.82rem',
                  }}
                >
                  <div style={{ color: 'var(--text-primary)' }}>{topic.text}</div>
                  {topic.addedByName && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      — {topic.addedByName}
                      {topic.addedAt ? ` · ${formatDate(topic.addedAt)}` : ''}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Input para proponer tema — solo participantes en checkin scheduled */}
          {canProposeTopic && (
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'flex-start',
                paddingTop:
                  checkin.agendaTopics && checkin.agendaTopics.length > 0
                    ? '0.6rem'
                    : 0,
                borderTop:
                  checkin.agendaTopics && checkin.agendaTopics.length > 0
                    ? '1px dashed var(--border)'
                    : 'none',
              }}
            >
              <input
                className="input"
                type="text"
                placeholder="Ej. Carga de trabajo del Q2, plan de capacitación en React…"
                value={newTopicText}
                maxLength={300}
                onChange={(e) => setNewTopicText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !addTopic.isPending && newTopicText.trim()) {
                    e.preventDefault();
                    handleAddTopic();
                  }
                }}
                disabled={addTopic.isPending}
                style={{ flex: 1, fontSize: '0.85rem' }}
              />
              <button
                className="btn-primary"
                onClick={handleAddTopic}
                disabled={addTopic.isPending || !newTopicText.trim()}
                style={{ fontSize: '0.82rem', padding: '0.45rem 1rem', whiteSpace: 'nowrap' }}
              >
                {addTopic.isPending ? 'Agregando…' : '+ Proponer tema'}
              </button>
            </div>
          )}

          {/* Read-only hint si no es participante o el checkin no está scheduled */}
          {!canProposeTopic &&
            (!checkin.agendaTopics || checkin.agendaTopics.length === 0) && (
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                }}
              >
                {isCompleted || isCancelled
                  ? 'Este check-in ya no acepta nuevos temas.'
                  : 'Solo los participantes pueden proponer temas.'}
              </p>
            )}
        </div>
      )}

      {/* Completion modal */}
      {checkin && (
        <CheckInCompletionModal
          open={completionOpen}
          checkinId={checkin.id}
          topic={checkin.topic}
          employeeName={employeeName}
          seedActionItems={pendingCombined.map((p) => ({
            text: p.text,
            assigneeName: p.assigneeName,
            dueDate: p.dueDate || null,
          }))}
          onClose={() => setCompletionOpen(false)}
          onCompleted={() => {
            toast.success('Check-in completado.');
            router.push('/dashboard/feedback');
          }}
        />
      )}
    </div>
  );
}

export default function AgendaPage() {
  return (
    <PlanGate feature="MAGIC_MEETINGS">
      <AgendaPageContent />
    </PlanGate>
  );
}
