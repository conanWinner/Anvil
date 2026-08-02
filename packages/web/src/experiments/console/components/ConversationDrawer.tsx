import { useMemo, useState, type ReactElement } from 'react';
import type { ConversationSummary } from '../primitives/conversation';
import type { ProjectMemoryEntry } from '../skills/projectMemory';
import { formatClock } from '../lib/format';

interface Props {
  open: boolean;
  conversations: ConversationSummary[];
  activeId: string | null;
  memory: ProjectMemoryEntry[];
  pending: boolean;
  error: string | null;
  onClose(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onUpdateMemory(
    entry: ProjectMemoryEntry,
    patch: { content?: string; pinned?: boolean }
  ): Promise<void>;
  onDeleteMemory(entryId: string): Promise<void>;
  onCreateMemory(content: string): Promise<void>;
}

export function ConversationDrawer(props: Props): ReactElement | null {
  const [tab, setTab] = useState<'chats' | 'memory'>('chats');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rows = useMemo(
    () =>
      props.conversations.filter(item =>
        (item.title ?? 'Untitled').toLowerCase().includes(search.toLowerCase())
      ),
    [props.conversations, search]
  );
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/30"
      onMouseDown={() => {
        props.onClose();
      }}
    >
      <aside
        aria-label="Conversation manager"
        className="h-full w-full max-w-[340px] overflow-y-auto border-r border-border bg-surface-elevated p-4 shadow-xl"
        onMouseDown={event => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Project context</h2>
          <button
            type="button"
            onClick={() => {
              props.onClose();
            }}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className={tab === 'chats' ? 'text-accent' : 'text-text-secondary'}
            onClick={() => {
              setTab('chats');
            }}
          >
            Chats
          </button>
          <button
            type="button"
            className={tab === 'memory' ? 'text-accent' : 'text-text-secondary'}
            onClick={() => {
              setTab('memory');
            }}
          >
            Project Memory
          </button>
        </div>
        {props.error !== null ? <p className="mt-3 text-xs text-error">{props.error}</p> : null}
        {tab === 'chats' ? (
          <div className="mt-4 space-y-2">
            <input
              aria-label="Search chats"
              value={search}
              onChange={event => {
                setSearch(event.target.value);
              }}
              placeholder="Search chats…"
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm"
            />
            {rows.map(item => (
              <div
                key={item.id}
                className={`rounded border p-2 ${item.id === props.activeId ? 'border-accent' : 'border-border'}`}
              >
                {editing === item.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={event => {
                      setDraft(event.target.value);
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && draft.trim())
                        void props.onRename(item.id, draft.trim()).then(() => {
                          setEditing(null);
                        });
                      if (event.key === 'Escape') setEditing(null);
                    }}
                    className="w-full bg-transparent"
                  />
                ) : (
                  <button
                    type="button"
                    className="w-full text-left text-sm"
                    onClick={() => {
                      props.onSelect(item.id);
                    }}
                  >
                    {item.title ?? 'Untitled conversation'}
                  </button>
                )}
                <div className="mt-1 flex items-center justify-between text-[10px] text-text-tertiary">
                  <span>{item.lastActivityAt ? formatClock(item.lastActivityAt) : ''}</span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(item.id);
                        setDraft(item.title ?? '');
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={props.pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Xóa chat này? Các workflow run vẫn được giữ trong Progress.'
                          )
                        )
                          void props.onDelete(item.id);
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="text-xs text-accent"
              onClick={() => {
                const content = window.prompt('Thông tin project cần ghi nhớ');
                if (content?.trim()) void props.onCreateMemory(content.trim());
              }}
            >
              + Add memory
            </button>
            {props.memory.map(entry => (
              <div key={entry.id} className="rounded border border-border p-3 text-xs">
                <div className="flex justify-between">
                  <span className="uppercase text-text-tertiary">{entry.category}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void props.onUpdateMemory(entry, { pinned: !entry.pinned });
                    }}
                  >
                    {entry.pinned ? '★' : '☆'}
                  </button>
                </div>
                <button
                  type="button"
                  className="mt-2 w-full text-left"
                  onClick={() => {
                    const content = window.prompt('Edit memory', entry.content);
                    if (content?.trim())
                      void props.onUpdateMemory(entry, { content: content.trim() });
                  }}
                >
                  {entry.content}
                </button>
                {entry.source_conversation_title !== null ? (
                  <p className="mt-1 text-[10px] text-text-tertiary">
                    From: {entry.source_conversation_title}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mt-2 text-error"
                  onClick={() => {
                    void props.onDeleteMemory(entry.id);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
