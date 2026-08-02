import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ChatStream } from '../components/ChatStream';
import { ChatComposer } from '../components/ChatComposer';
import { ProjectViewTabs } from '../components/ProjectViewTabs';
import { WorkingIndicator } from '../components/WorkingIndicator';
import { WorkflowDock } from '../components/WorkflowDock';
import { ContextUsageIndicator } from '../components/ContextUsageIndicator';
import { EmptyState } from '../components/EmptyState';
import { ConversationDrawer } from '../components/ConversationDrawer';
import { StreamContextProvider } from '../lib/stream-context';
import { useConversationSSE, type ContextUsage } from '../lib/sse';
import { useEntity, invalidate } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { Project } from '../primitives/project';
import type { Message } from '../primitives/message';
import type { ConversationSummary } from '../primitives/conversation';
import type { Workflow } from '../primitives/workflow';

// While a turn is active, refetch messages on this cadence so streamed replies
// still surface if a per-conversation SSE event is dropped (cross-origin
// EventSource in dev can miss bursts). Mirrors RunDetailPage's safety-net poll.
const ACTIVE_POLL_MS = 3000;
// Consider the turn done once the trailing message is an assistant reply that
// has stayed stable this long. Independent of any SSE lock event.
const SETTLE_MS = 6000;
// Hard cap so a turn that never produces a reply (server error, etc.) can't
// disable the composer forever.
const MAX_WAIT_MS = 300_000;
// Distance from the bottom (px) within which we treat the scroll as "at bottom"
// — drives both auto-scroll stickiness and the jump-to-bottom button's visibility.
const NEAR_BOTTOM_PX = 120;
const CONTEXT_USAGE_STORAGE_PREFIX = 'anvil.console.context-usage:';

function loadContextUsage(conversationId: string | null): ContextUsage | undefined {
  if (conversationId === null) return undefined;
  try {
    const raw = window.localStorage.getItem(`${CONTEXT_USAGE_STORAGE_PREFIX}${conversationId}`);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<ContextUsage>;
    return typeof parsed.tokensIn === 'number' ? (parsed as ContextUsage) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Project-scoped agent chat. A tab peer of the runs view under a project.
 *
 * MVP conversation model: one active conversation per project — the most-recent
 * web conversation, or created lazily on first send. No multi-conversation
 * sidebar yet (spike decision #3, deferred).
 *
 * Data flow mirrors RunDetailPage: load messages via useEntity(K.messages),
 * keep live via useConversationSSE (invalidate → refetch), render with the
 * shared MessageItem/ToolCallItem cards inside a StreamContextProvider.
 */
export function ChatPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: project } = useEntity<Project | null>(
    projectId !== undefined ? K.project(projectId) : 'noop:no-project',
    () => (projectId !== undefined ? skill.getProject(projectId) : Promise.resolve(null))
  );

  const { data: conversations, error: conversationsError } = useEntity<ConversationSummary[]>(
    projectId !== undefined ? K.conversations(projectId) : 'noop:no-project-convs',
    () => (projectId !== undefined ? skill.listConversations(projectId) : Promise.resolve([]))
  );
  const requestedIntake = searchParams.get('intake');
  const { data: workflowResult } = useEntity<skill.WorkflowListResult>(
    projectId !== undefined && project?.path !== undefined
      ? K.workflows(projectId, project.path)
      : 'noop:chat-intake-workflows',
    () =>
      project?.path !== undefined
        ? skill.listWorkflows(project.path)
        : Promise.resolve({ workflows: [], recommended: [] })
  );
  const intakeWorkflows = useMemo(
    () => workflowResult?.workflows.filter(workflow => workflow.hasIntake) ?? [],
    [workflowResult]
  );
  const { data: intakeEntries } = useEntity<
    { workflow: Workflow; draft: skill.WorkflowIntakeDraft }[]
  >(
    projectId !== undefined && workflowResult !== undefined
      ? K.intakes(projectId)
      : 'noop:chat-intake-drafts',
    async () => {
      if (projectId === undefined) return [];
      const entries = await Promise.all(
        intakeWorkflows.map(async workflow => ({
          workflow,
          draft: await skill.getWorkflowIntake(projectId, workflow.name),
        }))
      );
      return entries.flatMap(entry =>
        entry.draft === null ? [] : [{ workflow: entry.workflow, draft: entry.draft }]
      );
    }
  );
  const activeIntake = useMemo(
    () =>
      [...(intakeEntries ?? [])]
        .filter(entry => entry.draft.status === 'draft' || entry.draft.status === 'ready')
        .sort((left, right) => right.draft.updatedAt.localeCompare(left.draft.updatedAt))[0],
    [intakeEntries]
  );

  const requestedConversation = searchParams.get('conversation');
  const [activeConvId, setActiveConvId] = useState<string | null>(requestedConversation);
  const [newChat, setNewChat] = useState(false);
  const clientRequestIdRef = useRef(crypto.randomUUID());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const handoffConversationRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeConvId !== null || newChat) return;
    const web = (conversations ?? []).find(c => c.platformType === 'web');
    if (web !== undefined) {
      setActiveConvId(web.id);
      setSearchParams(
        params => {
          const next = new URLSearchParams(params);
          next.set('conversation', web.id);
          return next;
        },
        { replace: true }
      );
    } else if (conversations !== undefined) {
      setNewChat(true);
    }
  }, [conversations, activeConvId, newChat, setSearchParams]);

  const { data: projectMemory } = useEntity<skill.ProjectMemoryEntry[]>(
    projectId !== undefined ? `project-memory:${projectId}` : 'noop:project-memory',
    () => (projectId !== undefined ? skill.listProjectMemory(projectId) : Promise.resolve([]))
  );

  const { data: messages, error: messagesError } = useEntity<Message[]>(
    activeConvId !== null ? K.messages(activeConvId) : 'noop:no-conv',
    () => (activeConvId !== null ? skill.listMessages(activeConvId) : Promise.resolve([]))
  );

  // `busy` = a reply is pending → composer disabled + recovery poll active.
  // Driven by message content and the send action, NOT by the SSE lock event,
  // so it stays correct even when the per-conversation SSE drops or never
  // connects (which it can, cross-origin in dev). SSE is a pure accelerator.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-error advisory (distinct channel from `error` so it doesn't read as a
  // send failure) — e.g. files dropped from a first message.
  const [notice, setNotice] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage>();

  // Turn-completion state. The settle timer (below) is the correctness floor — it
  // works even when SSE is absent. The SSE lock event is a fast-path on top of it.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleSigRef = useRef('');

  // SSE accelerator: invalidates the message cache on text/tool events, and via
  // onLockChange clears `busy` the instant the server releases the conversation
  // lock (conversation_lock:false) instead of waiting out SETTLE_MS. Must be
  // useCallback-stable — the hook's effect depends on it, so an inline lambda
  // would reconnect the EventSource on every render.
  const onLockChange = useCallback((locked: boolean): void => {
    if (locked) return;
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setBusy(false);
  }, []);
  const onContextUsage = useCallback(
    (usage: ContextUsage): void => {
      setContextUsage(usage);
      if (activeConvId !== null) {
        window.localStorage.setItem(
          `${CONTEXT_USAGE_STORAGE_PREFIX}${activeConvId}`,
          JSON.stringify(usage)
        );
      }
    },
    [activeConvId]
  );
  useConversationSSE(activeConvId, onLockChange, onContextUsage);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (activeConvId !== null) return activeConvId;
    if (projectId === undefined) throw new Error('Không tìm thấy project hiện tại.');
    const conversation = await skill.createConversation(projectId);
    setActiveConvId(conversation.conversationId);
    setNewChat(false);
    setSearchParams(
      params => {
        const next = new URLSearchParams(params);
        next.set('conversation', conversation.conversationId);
        return next;
      },
      { replace: true }
    );
    invalidate(K.conversations(projectId));
    return conversation.conversationId;
  }, [activeConvId, projectId, setSearchParams]);

  const advanceIntake = useCallback(
    async (workflowName: string, message: string, files?: File[]): Promise<void> => {
      if (projectId === undefined) return;
      setError(null);
      setNotice(null);
      setBusy(true);
      try {
        const conversationId = await ensureConversation();
        let result: skill.WorkflowIntakeChatResponse;
        if (files !== undefined && files.length > 0) {
          if (files.length !== 1) throw new Error('Mỗi bước Intake chỉ nhận một file.');
          const file = files[0];
          if (file === undefined) throw new Error('Không tìm thấy file Intake đã chọn.');
          if (/^\/start(?:\s+.+)?$/i.test(message.trim())) {
            await skill.chatWorkflowIntake(projectId, workflowName, conversationId, message);
          }
          const attached = await skill.attachWorkflowIntakeFile(
            projectId,
            workflowName,
            conversationId,
            file
          );
          result = { draft: attached.draft, state: attached.state, shouldStart: false };
        } else {
          result = await skill.chatWorkflowIntake(projectId, workflowName, conversationId, message);
        }
        invalidate(K.messages(conversationId));
        invalidate(K.intake(projectId, workflowName));
        invalidate(K.intakes(projectId));
        setBusy(false);
        if (result.shouldStart) {
          const started = await skill.startWorkflowIntake(projectId, workflowName, conversationId);
          invalidate(K.runs(projectId));
          invalidate(K.flowRuns(projectId));
          invalidate(K.intake(projectId, workflowName));
          invalidate(K.intakes(projectId));
          if (started.runId === null) {
            throw new Error('Workflow chưa tạo được run sau khi xác nhận Intake.');
          }
          navigate(`/console/p/${projectId}/flow?run=${encodeURIComponent(started.runId)}`);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không thể xử lý Intake.');
        setBusy(false);
      }
    },
    [ensureConversation, navigate, projectId]
  );

  const handledIntakeParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (requestedIntake === null) {
      handledIntakeParamRef.current = null;
      return;
    }
    if (workflowResult === undefined) return;
    if (handledIntakeParamRef.current === requestedIntake) return;
    const workflow = workflowResult.workflows.find(
      item => item.name === requestedIntake && item.hasIntake
    );
    if (!workflow) {
      setError(`Workflow '${requestedIntake}' không có Intake.`);
      return;
    }
    handledIntakeParamRef.current = requestedIntake;
    const next = new URLSearchParams(searchParams);
    next.delete('intake');
    setSearchParams(next, { replace: true });
    void advanceIntake(workflow.name, `/start ${workflow.name}`);
  }, [advanceIntake, requestedIntake, searchParams, setSearchParams, workflowResult]);

  useEffect(() => {
    setContextUsage(loadContextUsage(activeConvId));
  }, [activeConvId]);

  // Derive turn state from the trailing message: a user message means a reply
  // is pending; once an assistant reply lands and stays stable for SETTLE_MS the
  // turn is done. This also recovers a reload mid-turn (trailing user message).
  useEffect(() => {
    const list = messages ?? [];
    const last = list[list.length - 1];
    if (last === undefined) return;
    if (last.role === 'user') {
      settleSigRef.current = '';
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      setBusy(true);
      return;
    }
    // Trailing message is an assistant/system reply. Arm the settle timer once;
    // re-arm only on real content change so identical poll refetches (same sig)
    // don't reset it forever.
    const sig = `${list.length}:${last.id}`;
    if (sig === settleSigRef.current) return;
    settleSigRef.current = sig;
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      setBusy(false);
    }, SETTLE_MS);
  }, [messages]);
  useEffect(
    () => (): void => {
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    },
    []
  );

  // Recovery poll: while a reply is pending, refetch messages on a cadence so a
  // dropped or absent SSE event can't hide the reply. Hard-caps at MAX_WAIT_MS.
  const busySinceRef = useRef(0);
  useEffect(() => {
    if (!busy || activeConvId === null) return;
    busySinceRef.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - busySinceRef.current > MAX_WAIT_MS) {
        setBusy(false);
        return;
      }
      invalidate(K.messages(activeConvId));
    }, ACTIVE_POLL_MS);
    return (): void => {
      clearInterval(id);
    };
  }, [busy, activeConvId]);

  // Reveal the raw tool trace inline (toggled from the working indicator).
  const [showTools, setShowTools] = useState(false);

  const onSend = (text: string, files?: File[]): void => {
    if (projectId === undefined) return;
    const startMatch = /^\/start(?:\s+(.+?))?$/i.exec(text.trim());
    if (startMatch !== null) {
      if (workflowResult === undefined) {
        setError(null);
        setNotice('Đang tải danh sách workflow. Vui lòng thử lại sau giây lát.');
        setBusy(false);
        return;
      }
      const requestedName = startMatch[1]?.trim().toLowerCase();
      if (!requestedName) {
        setError(null);
        setNotice(
          intakeWorkflows.length > 0
            ? `Hãy chọn workflow: ${intakeWorkflows.map(workflow => `/start ${workflow.name}`).join(', ')}`
            : 'Project hiện tại không có workflow nào khai báo Intake.'
        );
        setBusy(false);
        return;
      }
      const workflow = intakeWorkflows.find(item => {
        const name = item.name.toLowerCase();
        return name === requestedName || name === `${requestedName}-master`;
      });
      if (workflow !== undefined) {
        void advanceIntake(workflow.name, text, files);
        return;
      }
      setNotice(null);
      setError(`Không tìm thấy workflow Intake '${startMatch[1]?.trim() ?? ''}' trong project.`);
      setBusy(false);
      return;
    }
    if (
      activeIntake !== undefined &&
      activeIntake.draft.currentField !== null &&
      (activeIntake.draft.status === 'draft' || activeIntake.draft.status === 'ready')
    ) {
      void advanceIntake(activeIntake.workflow.name, text, files);
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true); // optimistic: disable the composer immediately
    void (async (): Promise<void> => {
      try {
        let conversationId = activeConvId;
        if (conversationId === null) {
          const created = await skill.createConversation(
            projectId,
            text,
            clientRequestIdRef.current,
            files
          );
          const createdConversationId = created.conversationId;
          conversationId = createdConversationId;
          setActiveConvId(createdConversationId);
          setNewChat(false);
          setSearchParams(
            params => {
              const next = new URLSearchParams(params);
              next.set('conversation', createdConversationId);
              return next;
            },
            { replace: true }
          );
          invalidate(K.conversations(projectId));
        } else {
          await skill.sendMessage(conversationId, text, files);
        }
        invalidate(K.messages(conversationId));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Send failed.');
        setBusy(false); // unblock so the user can retry
      }
      // On success `busy` stays true until the settle detector sees the reply.
    })();
  };

  const selectConversation = useCallback(
    (conversationId: string): void => {
      setActiveConvId(conversationId);
      setNewChat(false);
      setDrawerOpen(false);
      setSearchParams(params => {
        const next = new URLSearchParams(params);
        next.set('conversation', conversationId);
        return next;
      });
    },
    [setSearchParams]
  );

  const startNewChat = useCallback(async (): Promise<void> => {
    const previous = activeConvId;
    setActiveConvId(null);
    setNewChat(true);
    setDrawerOpen(false);
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.delete('conversation');
      return next;
    });
    clientRequestIdRef.current = crypto.randomUUID();
    if (previous === null || projectId === undefined) return;
    handoffConversationRef.current = previous;
    setHandoffPending(true);
    setHandoffError(null);
    try {
      await skill.handoffProjectMemory(projectId, previous);
      invalidate(`project-memory:${projectId}`);
    } catch (cause: unknown) {
      setHandoffError(
        cause instanceof Error ? cause.message : 'Không thể cập nhật Project Memory.'
      );
    } finally {
      setHandoffPending(false);
    }
  }, [activeConvId, projectId, setSearchParams]);

  const retryHandoff = useCallback(async (): Promise<void> => {
    if (projectId === undefined || handoffConversationRef.current === null) return;
    setHandoffPending(true);
    setHandoffError(null);
    try {
      await skill.handoffProjectMemory(projectId, handoffConversationRef.current);
      invalidate(`project-memory:${projectId}`);
    } catch (cause: unknown) {
      setHandoffError(
        cause instanceof Error ? cause.message : 'Không thể cập nhật Project Memory.'
      );
    } finally {
      setHandoffPending(false);
    }
  }, [projectId]);

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void startNewChat();
      } else if (event.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', listener);
    return (): void => {
      window.removeEventListener('keydown', listener);
    };
  }, [drawerOpen, startNewChat]);

  // Inline auto-scroll: stick to bottom on new messages if already near it.
  // Mirrors RunDetailPage's variant.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    lastBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !lastBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  // Jump-to-bottom affordance: `atBottom` (state) drives the button's visibility;
  // `lastBottomRef` (above) drives the auto-scroll stickiness. Keep them in sync.
  const [atBottom, setAtBottom] = useState(true);
  const handleScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    lastBottomRef.current = near;
    setAtBottom(near);
  }, []);
  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }, []);

  if (projectId === undefined) {
    return <EmptyState title="No project selected." />;
  }

  const messageList = messages ?? [];
  const activeConversation = (conversations ?? []).find(item => item.id === activeConvId);

  // Surface a failed (re)load of the conversation list or message history — a
  // revalidation can fail silently (network blip, server restart) and otherwise
  // leave stale/empty data with no signal. Send errors take precedence.
  const loadError = messagesError ?? conversationsError;

  // Current activity for the working indicator: the latest tool the agent
  // invoked in the in-flight turn (walk back to the last user message).
  const currentActivity = useMemo<string | null>(() => {
    for (let i = messageList.length - 1; i >= 0; i--) {
      const m = messageList[i];
      if (m === undefined) continue;
      if (m.role === 'user') break;
      if (m.role === 'assistant' && m.toolCalls.length > 0) {
        return m.toolCalls[m.toolCalls.length - 1]?.name ?? null;
      }
    }
    return null;
  }, [messageList]);

  return (
    <section className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium text-text-primary">
              {project?.name ?? 'Project'}
            </h1>
            <p className="text-xs text-text-tertiary">{project?.path ?? 'Loading…'}</p>
            <button
              type="button"
              className="mt-1 text-left text-xs text-text-secondary hover:text-text-primary"
              onClick={() => {
                setDrawerOpen(true);
              }}
            >
              {newChat
                ? 'New conversation'
                : (activeConversation?.title ?? 'Untitled conversation')}{' '}
              ▾
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void startNewChat();
              }}
              className="rounded border border-border px-3 py-1.5 text-xs hover:border-accent"
            >
              New Chat
            </button>
            <ContextUsageIndicator usage={contextUsage} />
          </div>
        </div>
        <ProjectViewTabs projectId={projectId} active="chat" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-[30px] pt-[26px] pb-[18px]"
        >
          {/* Match the composer's centered 940px column (design: .stream-inner) */}
          <div className="mx-auto max-w-[940px]">
            {messageList.length === 0 && !busy ? (
              <EmptyState
                title={newChat ? 'Cuộc trò chuyện mới' : 'No messages yet.'}
                hint={
                  newChat
                    ? 'Chat mới dùng Project Memory nhưng không mang toàn bộ lịch sử chat cũ.'
                    : 'Ask the agent about this project, or tell it what to run.'
                }
              />
            ) : (
              <StreamContextProvider value={{ runStartedAt: null }}>
                <ChatStream messages={messageList} showTools={showTools} />
                {busy ? (
                  <WorkingIndicator
                    activity={currentActivity}
                    expanded={showTools}
                    onToggle={() => {
                      setShowTools(v => !v);
                    }}
                  />
                ) : null}
              </StreamContextProvider>
            )}
          </div>
        </div>
        {!atBottom ? (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Jump to bottom"
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface-elevated px-3 py-1 text-[11px] text-text-secondary shadow-md transition-colors hover:text-text-primary"
          >
            <span aria-hidden>↓</span>
            Jump to bottom
          </button>
        ) : null}
      </div>

      <WorkflowDock projectId={projectId} />

      {notice !== null ? (
        <div className="shrink-0 border-t border-warning/30 bg-warning/[0.06] px-6 py-2 font-mono text-[11px] text-warning">
          {notice}
        </div>
      ) : null}

      {handoffPending ? (
        <div className="shrink-0 border-t border-border px-6 py-2 text-xs text-text-secondary">
          Đang chuẩn bị ngữ cảnh project…
        </div>
      ) : null}
      {handoffError !== null ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-error/30 px-6 py-2 text-xs text-error">
          <span>{handoffError}</span>
          <button
            type="button"
            onClick={() => {
              void retryHandoff();
            }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => {
              setHandoffError(null);
            }}
          >
            Start without memory update
          </button>
        </div>
      ) : null}

      {error !== null || loadError !== undefined ? (
        <div className="shrink-0 border-t border-error/30 bg-error/[0.06] px-6 py-2 font-mono text-[11px] text-error">
          {error ?? `Failed to load chat: ${loadError?.message ?? 'unknown error'}`}
        </div>
      ) : null}

      <ChatComposer
        onSend={onSend}
        disabled={busy || handoffPending || handoffError !== null}
        intakeWorkflows={intakeWorkflows.map(workflow => ({
          name: workflow.name,
          title: workflow.intake?.title,
        }))}
      />
      <ConversationDrawer
        open={drawerOpen}
        conversations={(conversations ?? []).filter(item => item.platformType === 'web')}
        activeId={activeConvId}
        memory={projectMemory ?? []}
        pending={busy}
        error={null}
        onClose={() => {
          setDrawerOpen(false);
        }}
        onSelect={selectConversation}
        onRename={async (id, title) => {
          await skill.renameConversation(id, title);
          invalidate(K.conversations(projectId));
        }}
        onDelete={async id => {
          await skill.deleteConversation(id);
          invalidate(K.conversations(projectId));
          if (id === activeConvId) {
            const next = (conversations ?? []).find(
              item => item.id !== id && item.platformType === 'web'
            );
            if (next) selectConversation(next.id);
            else await startNewChat();
          }
        }}
        onUpdateMemory={async (entry, patch) => {
          await skill.updateProjectMemory(projectId, entry.id, patch);
          invalidate(`project-memory:${projectId}`);
        }}
        onDeleteMemory={async id => {
          await skill.deleteProjectMemory(projectId, id);
          invalidate(`project-memory:${projectId}`);
        }}
        onCreateMemory={async content => {
          await skill.createProjectMemory(projectId, content);
          invalidate(`project-memory:${projectId}`);
        }}
      />
    </section>
  );
}
