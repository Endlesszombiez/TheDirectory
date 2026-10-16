import { useEffect, useRef, useState } from 'react';
import Pastebin from './Pastebin';
import {
  Download,
  FolderUp,
  LockKeyhole,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

type Settings = {
  maxFileMB: number;
  allowedExtensions: string;
  autoUpload: boolean;
  showFileList: boolean;
  configured: boolean;
  unlocked: boolean;
  admin: boolean;
};
type Entry = {
  path: string;
  size: number;
  directory: boolean;
  modified: string;
};
type Item = {
  file: File;
  path: string;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
};
const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : size < 1073741824
        ? `${(size / 1048576).toFixed(1)} MB`
        : `${(size / 1073741824).toFixed(1)} GB`;

export default function Files() {
  const [tab, setTab] = useState<'files' | 'pastes'>('files');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState({ totalBytes: 0, totalFiles: 0 });
  const [items, setItems] = useState<Item[]>([]);
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');
  const [remove, setRemove] = useState<Entry | null>(null);
  const [destination, setDestination] = useState('');
  const active = useRef<XMLHttpRequest | null>(null);
  const cancelled = useRef(false);
  const running = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  async function request(action: string, method = 'GET', body?: unknown) {
    const response = await fetch(`/api/files/${action}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && action !== 'unlock')
        setSettings((s) => s && { ...s, unlocked: false });
      throw new Error(data.error || 'File operation failed.');
    }
    return data;
  }
  async function refresh(current?: Settings) {
    const next: Settings = current || (await request('status'));
    setSettings(next);
    if (next.unlocked && next.showFileList) {
      const listing = await request('list');
      setEntries(listing.entries);
      setTotals(listing);
    } else {
      setEntries([]);
      setTotals({ totalBytes: 0, totalFiles: 0 });
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    return () => {
      cancelled.current = true;
      active.current?.abort();
    };
  }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function update(item: Item, change: Partial<Item>) {
    Object.assign(item, change);
    setItems((list) => [...list]);
  }
  async function upload(batch: Item[]) {
    if (running.current || !settings?.unlocked) return;
    running.current = true;
    cancelled.current = false;
    setUploading(true);
    setError('');
    try {
      for (const item of batch) {
        if (cancelled.current) break;
        if (item.status === 'done') continue;
        update(item, { status: 'uploading', progress: 0, error: undefined });
        try {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            active.current = xhr;
            xhr.open(
              'POST',
              `/api/files/upload?path=${encodeURIComponent(item.path)}`,
            );
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.upload.onprogress = (event) =>
              update(item, {
                progress: event.lengthComputable
                  ? Math.round((event.loaded / event.total) * 100)
                  : 0,
              });
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else {
                let message = 'Upload failed.';
                try {
                  message = JSON.parse(xhr.responseText).error;
                } catch {}
                reject(new Error(message));
              }
            };
            xhr.onerror = () =>
              reject(new Error('Connection lost. Retry this upload.'));
            xhr.onabort = () => reject(new Error('Upload cancelled.'));
            xhr.send(item.file);
          });
          update(item, { status: 'done', progress: 100 });
        } catch (e) {
          update(item, { status: 'error', error: (e as Error).message });
        }
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      active.current = null;
      running.current = false;
      setUploading(false);
    }
  }
  function select(files: File[]) {
    if (running.current || !settings) return;
    const prefix = destination.trim().replace(/\/+$/, '');
    const batch: Item[] = files.map((file) => {
      const path = [prefix, file.webkitRelativePath || file.name]
        .filter(Boolean)
        .join('/');
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      const allowed = settings.allowedExtensions
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const error =
        file.size > settings.maxFileMB * 1048576
          ? 'File exceeds the upload size limit.'
          : allowed.length && !allowed.includes(extension)
            ? 'This file type is not allowed.'
            : undefined;
      return {
        file,
        path,
        progress: 0,
        status: error ? 'error' : 'queued',
        error,
      };
    });
    setItems(batch);
    setError('');
    if (settings.autoUpload) void upload(batch.filter((item) => !item.error));
  }
  async function dropped(transfer: DataTransfer) {
    // Directory entries must be captured before the drop event returns.
    const roots = Array.from(transfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean) as FileSystemEntry[];
    if (!roots.length) {
      select(Array.from(transfer.files));
      return;
    }
    const found: File[] = [];
    async function walk(entry: FileSystemEntry, prefix = ''): Promise<void> {
      if (found.length >= 10000)
        throw new Error('Select at most 10,000 files at once.');
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        Object.defineProperty(file, 'webkitRelativePath', {
          value: prefix + file.name,
        });
        found.push(file);
      } else {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        while (true) {
          const batch = await new Promise<FileSystemEntry[]>(
            (resolve, reject) => reader.readEntries(resolve, reject),
          );
          if (!batch.length) break;
          for (const child of batch)
            await walk(child, `${prefix}${entry.name}/`);
        }
      }
    }
    try {
      for (const root of roots) await walk(root);
      select(found);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="files-workspace">
      <div className="page-heading">
        <div>
          <span className="files-eyebrow">THE DIRECTORY</span>
          <h1>Files</h1>
          <p className="files-muted">Drop it here. Pick it up anywhere.</p>
        </div>
        {settings?.unlocked && (
          <button
            className="button"
            disabled={uploading || busy}
            onClick={() =>
              void act(async () => {
                await request('lock', 'POST');
                setItems([]);
                await refresh();
              })
            }
          >
            <LockKeyhole size={16} /> Lock files
          </button>
        )}
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!settings ? (
        <p role="status">Loading files…</p>
      ) : !settings.unlocked ? (
        <section className="files-lock files-panel">
          <div className="files-symbol">
            <LockKeyhole size={28} />
          </div>
          <h2>
            {settings.configured
              ? 'Your files, behind a PIN.'
              : 'Set up file sharing'}
          </h2>
          <p className="files-muted">
            {settings.configured
              ? 'Enter the shared PIN or password to upload, download, and manage files.'
              : 'An administrator needs to set a PIN before files can be shared.'}
          </p>
          {settings.configured && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await request('unlock', 'POST', { pin });
                  setPin('');
                  await refresh();
                });
              }}
            >
              <label htmlFor="files-pin">PIN or password</label>
              <input
                id="files-pin"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
              <button className="button primary" disabled={busy}>
                Unlock files
              </button>
            </form>
          )}
          {!settings.admin && (
            <a className="files-muted" href="/login">
              Administrator sign in
            </a>
          )}
        </section>
      ) : (
        <>
          <div className="files-actions" role="group" aria-label="Sharing area">
            <button
              className={`button ${tab === 'files' ? 'primary' : ''}`}
              aria-pressed={tab === 'files'}
              onClick={() => setTab('files')}
            >
              Files
            </button>
            <button
              className={`button ${tab === 'pastes' ? 'primary' : ''}`}
              aria-pressed={tab === 'pastes'}
              onClick={() => setTab('pastes')}
            >
              Pastebin
            </button>
          </div>
          <div className="files-tab-content" hidden={tab !== 'pastes'}>
            <Pastebin request={request} />
          </div>
          <div className="files-tab-content" hidden={tab !== 'files'}>
            <section
              className={`files-drop files-panel ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploading) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!uploading) void dropped(e.dataTransfer);
              }}
            >
              <div className="files-symbol">
                <FolderUp size={32} />
              </div>
              <h2>Drop files or folders here</h2>
              <p className="files-muted">
                Up to {settings.maxFileMB.toLocaleString()} MB per file
                {settings.allowedExtensions
                  ? ` · ${settings.allowedExtensions}`
                  : ' · All file types'}
              </p>
              <div className="files-actions">
                <button
                  className="button primary"
                  disabled={uploading}
                  onClick={() => picker.current?.click()}
                >
                  <Upload size={16} /> Choose files
                </button>
                <button
                  className="button"
                  disabled={uploading}
                  onClick={() => folder.current?.click()}
                >
                  <FolderUp size={16} /> Choose folder
                </button>
              </div>
              <input
                ref={picker}
                type="file"
                hidden
                multiple
                accept={settings.allowedExtensions || undefined}
                onChange={(e) => {
                  select(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
              <input
                ref={folder}
                type="file"
                hidden
                multiple
                {...{ webkitdirectory: '' }}
                onChange={(e) => {
                  select(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
              <label className="files-destination">
                Upload into folder (optional)
                <input
                  placeholder="e.g. Photos / leave empty for root"
                  value={destination}
                  disabled={uploading}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </label>
            </section>
            {items.length > 0 && (
              <section className="files-panel">
                <div className="files-section-heading">
                  <h2>
                    Upload queue{' '}
                    <small>
                      {items.filter((i) => i.status === 'done').length}/
                      {items.length}
                    </small>
                  </h2>
                  <div className="files-actions">
                    {uploading ? (
                      <button
                        className="button"
                        onClick={() => {
                          cancelled.current = true;
                          active.current?.abort();
                        }}
                      >
                        Cancel uploads
                      </button>
                    ) : (
                      <>
                        <button
                          className="button primary"
                          disabled={items.every((i) => i.status === 'done')}
                          onClick={() => void upload(items)}
                        >
                          <Upload size={16} /> Upload / retry
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Clear queue"
                          onClick={() => setItems([])}
                        >
                          <X size={18} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {items.map((item, index) => (
                  <div className="files-queue-item" key={index}>
                    <div>
                      <strong>{item.path}</strong>
                      <span className="files-muted">
                        {bytes(item.file.size)} ·{' '}
                        {item.status === 'uploading'
                          ? `${item.progress}%`
                          : item.status}
                      </span>
                    </div>
                    <progress
                      max={100}
                      value={item.progress}
                      aria-label={`Upload progress for ${item.path}`}
                    />
                    {item.error && (
                      <p className="files-error" role="status">
                        {item.error}
                      </p>
                    )}
                  </div>
                ))}
              </section>
            )}
            {settings.showFileList && (
              <section className="files-panel">
                <div className="files-section-heading">
                  <div>
                    <h2>Shared files</h2>
                    <p className="files-muted">
                      {totals.totalFiles} files · {bytes(totals.totalBytes)}{' '}
                      used
                    </p>
                  </div>
                  <button
                    className="button"
                    disabled={busy || uploading}
                    onClick={() =>
                      void act(async () => {
                        await refresh();
                      })
                    }
                  >
                    <RefreshCw size={16} /> Refresh
                  </button>
                </div>
                <input
                  className="files-search"
                  type="search"
                  placeholder="Find a file or folder…"
                  aria-label="Find files"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                {!entries.length && (
                  <p className="files-empty">
                    Nothing here yet. Your first upload starts here.
                  </p>
                )}
                <div className="files-list">
                  {entries
                    .filter((entry) =>
                      entry.path.toLowerCase().includes(filter.toLowerCase()),
                    )
                    .map((entry) => (
                      <div className="files-row" key={entry.path}>
                        <div className="files-name">
                          <span>{entry.directory ? '📁' : '📄'}</span>
                          <div>
                            <strong>{entry.path}</strong>
                            <small>
                              {entry.directory ? 'Folder' : bytes(entry.size)} ·{' '}
                              {new Date(entry.modified).toLocaleString()}
                            </small>
                          </div>
                        </div>
                        <div className="files-actions">
                          {!entry.directory && (
                            <a
                              className="icon-button"
                              aria-label={`Download ${entry.path}`}
                              href={`/api/files/download?path=${encodeURIComponent(entry.path)}`}
                            >
                              <Download size={18} />
                            </a>
                          )}
                          <button
                            className="icon-button"
                            disabled={uploading || busy}
                            aria-label={`Delete ${entry.path}`}
                            onClick={() => setRemove(entry)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}
            {remove && (
              <div
                className="files-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="files-delete-title"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRemove(null);
                }}
              >
                <section className="files-panel">
                  <h2 id="files-delete-title">
                    Delete {remove.directory ? 'folder' : 'file'}?
                  </h2>
                  <p>
                    {remove.path}
                    {remove.directory ? ' and everything inside it' : ''} will
                    be permanently deleted.
                  </p>
                  <div className="files-actions">
                    <button
                      autoFocus
                      className="button"
                      disabled={busy}
                      onClick={() => setRemove(null)}
                    >
                      Keep it
                    </button>
                    <button
                      className="button files-error"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request(
                            `delete?path=${encodeURIComponent(remove.path)}`,
                            'DELETE',
                          );
                          setRemove(null);
                          await refresh();
                        })
                      }
                    >
                      Delete permanently
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </>
      )}
      {settings?.admin && (
        <details className="files-panel files-settings">
          <summary>File sharing settings</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await request('settings', 'PUT', {
                  maxFileMB: settings.maxFileMB,
                  allowedExtensions: settings.allowedExtensions,
                  autoUpload: settings.autoUpload,
                  showFileList: settings.showFileList,
                  ...(newPin ? { pin: newPin } : {}),
                });
                setNewPin('');
                await refresh();
                setMessage(
                  'File sharing settings saved. Share this page and the PIN with your guests.',
                );
              });
            }}
          >
            <p className="files-muted">
              Anyone with the PIN can upload
              {settings.showFileList
                ? ', download, and delete shared files'
                : ' files'}
              . Changing it locks existing file sessions.
            </p>
            <label>
              New PIN or password
              <input
                type="password"
                autoComplete="new-password"
                minLength={4}
                maxLength={128}
                required={!settings.configured}
                placeholder={
                  settings.configured
                    ? 'Leave blank to keep current PIN'
                    : 'At least 4 characters'
                }
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
              />
            </label>
            <label>
              Maximum file size (MB)
              <input
                type="number"
                required
                min={1}
                max={102400}
                value={settings.maxFileMB}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxFileMB: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Allowed extensions
              <input
                placeholder="All types, or .jpg,.png,.pdf"
                maxLength={1000}
                value={settings.allowedExtensions}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    allowedExtensions: e.target.value,
                  })
                }
              />
            </label>
            <label className="files-check">
              <input
                type="checkbox"
                checked={settings.autoUpload}
                onChange={(e) =>
                  setSettings({ ...settings, autoUpload: e.target.checked })
                }
              />{' '}
              Upload automatically on selection
            </label>
            <label className="files-check">
              <input
                type="checkbox"
                checked={settings.showFileList}
                onChange={(e) =>
                  setSettings({ ...settings, showFileList: e.target.checked })
                }
              />{' '}
              Enable file listing, downloads, and deletion
            </label>
            <button className="button primary" disabled={busy || uploading}>
              Save settings
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
