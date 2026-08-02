import { Paperclip } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  formatBytes,
  isAcceptedFileType,
} from '../primitives/file';

interface ChatComposerProps {
  onSend: (message: string, files?: File[]) => void;
  disabled: boolean;
  disabledReason?: string;
  intakeWorkflows?: readonly { name: string; title?: string }[];
}

const MAX_HEIGHT = 200;

interface PickedFile {
  file: File;
  id: string;
}

interface ChatCommand {
  value: string;
  description: string;
}

const CHAT_COMMANDS: readonly ChatCommand[] = [
  { value: '/start', description: 'Chuẩn bị đầu vào cho một workflow' },
  { value: '/status', description: 'Xem phase và hành động đang chờ' },
  { value: '/continue', description: 'Đi tiếp qua phase đang chờ xác nhận' },
  { value: '/approve', description: 'Phê duyệt approval nghiệp vụ đang chờ' },
  { value: '/reject', description: 'Từ chối approval nghiệp vụ đang chờ' },
  { value: '/stop', description: 'Dừng run đang hoạt động' },
  { value: '/help', description: 'Xem trợ giúp lệnh' },
  { value: '/workflow', description: 'Lệnh workflow nâng cao' },
];

/**
 * Console-native chat composer. Auto-growing textarea, Enter sends,
 * Shift+Enter newline, Escape blurs. Click-to-attach files via the paperclip
 * icon (the send skill builds the multipart upload).
 *
 * Reimplemented (not imported) from the old chat's MessageInput because the
 * console may not import production `@/components/**` (ESLint isolation rule).
 *
 * Direction-B `cbox` shell: rounded card with `:focus-within` magenta ring,
 * paperclip attach + decorative `/` lead buttons, gradient `.brand-bar` Send
 * button + glow, kbd-hint row beneath. Attached files render as removable
 * chips above.
 */
export function ChatComposer({
  onSend,
  disabled,
  disabledReason,
  intakeWorkflows = [],
}: ChatComposerProps): ReactElement {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [commandPaletteDismissed, setCommandPaletteDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);

  const availableCommands = useMemo<readonly ChatCommand[]>(
    () => [
      ...intakeWorkflows.map(workflow => ({
        value: `/start ${workflow.name}`,
        description: workflow.title ?? `Chuẩn bị đầu vào cho ${workflow.name}`,
      })),
      ...CHAT_COMMANDS,
    ],
    [intakeWorkflows]
  );
  const commandMatches = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query.startsWith('/')) return [];
    return availableCommands.filter(command => command.value.startsWith(query));
  }, [availableCommands, value]);
  const commandPaletteOpen = !commandPaletteDismissed && commandMatches.length > 0;

  useEffect(() => {
    setActiveCommandIndex(index => Math.min(index, Math.max(0, commandMatches.length - 1)));
  }, [commandMatches.length]);

  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next.toString()}px`;
    el.style.overflowY = next >= MAX_HEIGHT ? 'auto' : 'hidden';
  };

  const addFiles = (incoming: File[]): void => {
    const next = [...files];
    // Accumulate every rejection reason (not just the last) so a mixed pick
    // surfaces all of them.
    const skipped: string[] = [];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) {
        skipped.push(`${file.name}: over the ${String(MAX_FILES)}-file limit`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        skipped.push(`${file.name}: larger than ${String(MAX_FILE_MB)} MB`);
        continue;
      }
      if (!isAcceptedFileType(file)) {
        skipped.push(`${file.name}: unsupported type`);
        continue;
      }
      next.push({ file, id: String(idRef.current++) });
    }
    setFiles(next);
    setFileError(
      skipped.length > 0
        ? `Skipped ${String(skipped.length)} file(s) — ${skipped.join('; ')}`
        : null
    );
  };

  const removeFile = (id: string): void => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setFileError(null);
  };

  const submit = (): void => {
    const trimmed = value.trim();
    if ((trimmed.length === 0 && files.length === 0) || disabled) return;
    onSend(
      trimmed.length > 0 ? trimmed : 'Đã đính kèm file',
      files.length > 0 ? files.map(f => f.file) : undefined
    );
    setValue('');
    setCommandPaletteDismissed(false);
    setFiles([]);
    setFileError(null);
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
    if (textareaRef.current !== null) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  };

  const chooseCommand = (command: ChatCommand): void => {
    setValue(`${command.value} `);
    setActiveCommandIndex(0);
    setCommandPaletteDismissed(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (commandPaletteOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveCommandIndex(index => (index + 1) % commandMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveCommandIndex(index => (index - 1 + commandMatches.length) % commandMatches.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const command = commandMatches[activeCommandIndex];
        if (command !== undefined) chooseCommand(command);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCommandPaletteDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className="shrink-0 border-t border-border bg-surface px-[30px] py-[14px]"
      title={disabledReason}
    >
      <div className="mx-auto max-w-[940px]">
        {files.length > 0 ? (
          <div className="mb-[10px] flex flex-wrap gap-[6px]">
            {files.map(f => (
              <span
                key={f.id}
                className="flex items-center gap-[6px] rounded-[8px] border bg-[color:var(--surface-elevated)] py-[4px] pl-[9px] pr-[5px] text-[11.5px]"
                style={{ borderColor: 'var(--border-bright)' }}
              >
                <span className="max-w-[180px] truncate text-text-primary">{f.file.name}</span>
                <span className="font-mono text-[10px] text-text-tertiary">
                  {formatBytes(f.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeFile(f.id);
                  }}
                  aria-label={`Remove ${f.file.name}`}
                  className="rounded p-[1px] text-text-tertiary transition-colors hover:bg-[color:var(--surface-hover)] hover:text-text-primary"
                >
                  <span aria-hidden className="text-[11px] leading-none">
                    ✕
                  </span>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {fileError !== null ? (
          <div className="mb-[8px] font-mono text-[11px] text-error">{fileError}</div>
        ) : null}
        <div className="relative">
          {commandPaletteOpen ? (
            <div
              role="listbox"
              aria-label="Chat commands"
              className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-full overflow-hidden rounded-xl border border-border-bright bg-surface-elevated p-1 shadow-xl"
            >
              {commandMatches.map((command, index) => (
                <button
                  key={command.value}
                  type="button"
                  role="option"
                  aria-selected={index === activeCommandIndex}
                  onMouseDown={event => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    chooseCommand(command);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    index === activeCommandIndex
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover'
                  }`}
                >
                  <code className="min-w-28 font-mono text-xs text-accent-bright">
                    {command.value}
                  </code>
                  <span className="text-xs">{command.description}</span>
                </button>
              ))}
              <p className="px-3 pb-1 pt-2 font-mono text-[10px] text-text-tertiary">
                ↑↓ chọn · Enter chèn lệnh · Esc đóng
              </p>
            </div>
          ) : null}
          <div
            className="flex items-end gap-[10px] rounded-[14px] border bg-[color:var(--surface-elevated)] py-[8px] pl-[14px] pr-[8px] transition-[border-color,box-shadow] focus-within:border-[color:color-mix(in_oklch,var(--brand-magenta),transparent_40%)] focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand-magenta),transparent_92%)]"
            style={{ borderColor: 'var(--border-bright)' }}
          >
            <div className="flex shrink-0 items-end gap-[6px] pb-[7px] text-text-tertiary">
              <button
                type="button"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                aria-label="Attach files"
                disabled={disabled || files.length >= MAX_FILES}
                title="Attach files"
                className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-text-primary disabled:cursor-default disabled:opacity-50"
              >
                <Paperclip className="h-5 w-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                className="hidden"
                onChange={e => {
                  if (e.target.files !== null) addFiles(Array.from(e.target.files));
                }}
              />
              <button
                type="button"
                tabIndex={0}
                aria-label="Commands"
                disabled={disabled}
                title="Commands"
                onClick={() => {
                  setValue('/');
                  setCommandPaletteDismissed(false);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
                className="flex h-[22px] items-center justify-center rounded-md px-[2px] text-[17px] leading-none transition-colors hover:bg-[color:var(--surface-hover)] hover:text-text-primary disabled:cursor-default disabled:opacity-50"
              >
                /
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => {
                setValue(e.target.value);
                setCommandPaletteDismissed(false);
                grow(e.target);
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={disabled ? (disabledReason ?? 'Waiting…') : 'Message the agent…'}
              className="min-h-0 flex-1 resize-none bg-transparent py-[7px] text-[14.5px] leading-[1.5] text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
              style={{ maxHeight: `${MAX_HEIGHT.toString()}px` }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={disabled || (value.trim().length === 0 && files.length === 0)}
              title="Send · Enter"
              className="brand-bar flex h-[36px] shrink-0 items-center gap-[7px] rounded-[10px] px-[15px] text-[13px] font-bold text-white shadow-[0_6px_18px_-8px_color-mix(in_oklch,var(--brand-magenta),transparent_30%)] transition-[filter,transform] hover:brightness-110 active:translate-y-[1px] disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100"
            >
              Send
              <span aria-hidden className="font-mono text-[10px] opacity-70">
                ↵
              </span>
            </button>
          </div>
        </div>
        <div className="mt-[9px] flex items-center justify-between px-[2px] font-mono text-[11px] text-text-tertiary">
          <span />
          <span>
            <span
              className="mr-1 inline-flex items-center rounded border px-[5px] py-[1px] font-mono text-[10.5px] text-text-secondary"
              style={{ borderColor: 'var(--border-bright)' }}
            >
              ↵
            </span>
            send{' '}
            <span
              className="ml-1 inline-flex items-center rounded border px-[5px] py-[1px] font-mono text-[10.5px] text-text-secondary"
              style={{ borderColor: 'var(--border-bright)' }}
            >
              ⇧↵
            </span>{' '}
            newline
          </span>
        </div>
      </div>
    </div>
  );
}
