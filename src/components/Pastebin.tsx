import { useEffect, useState } from 'react';
import { Clipboard, Copy, RefreshCw, Trash2 } from 'lucide-react';
import type { Paste } from '../lib/pastes';

type Props = {
  request: (action: string, method?: string, body?: unknown) => Promise<any>;
};

export default function Pastebin({ request }: Props) {
  const [pastes, setPastes] = useState<Paste[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [remove, setRemove] = useState<string | null>(null);
  async function refresh() {
    setLoading(true);
    try {
      const data = await request('pastes');
      setPastes(data.pastes);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function save(text: string) {
    if (!text.trim()) return;
    setPending((count) => count + 1);
    setError('');
    setMessage('');
    try {
      const paste: Paste = await request('pastes', 'POST', { text });
      setPastes((current) => [paste, ...current]);
      setDraft((current) => (current === text ? '' : current));
      setMessage('Paste saved. Ready for the next one.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending((count) => count - 1);
    }
  }
  return (
    <>
      <section className="files-panel paste-composer">
        <div className="files-section-heading">
          <div>
            <h2>
              <Clipboard size={18} /> Pastebin
            </h2>
            <p className="files-muted">
              Each paste is saved automatically as a new entry. Up to 1 MB per
              paste.
            </p>
          </div>
        </div>
        <label htmlFor="paste-text">Paste or type text</label>
        <textarea
          id="paste-text"
          rows={7}
          disabled={loading}
          placeholder="Paste something here…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain');
            if (!text) return;
            event.preventDefault();
            setDraft(text);
            void save(text);
          }}
        />
        <div className="files-actions">
          <button
            className="button primary"
            disabled={pending > 0 || !draft.trim()}
            onClick={() => void save(draft)}
          >
            Save typed text
          </button>
          <span className="files-muted" role="status">
            {pending
              ? `Saving ${pending} paste${pending === 1 ? '' : 's'}…`
              : message}
          </span>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="files-panel">
        <div className="files-section-heading">
          <h2>
            Saved pastes <small>{pastes.length}</small>
          </h2>
          <button
            className="button"
            disabled={loading || pending > 0}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {loading ? (
          <p role="status">Loading pastes…</p>
        ) : (
          !pastes.length && (
            <p className="files-empty">
              No pastes yet. Paste text above to save your first entry.
            </p>
          )
        )}
        {pastes.map((paste) => (
          <article className="paste-entry" key={paste.id}>
            <div className="files-section-heading">
              <time className="files-muted" dateTime={paste.created}>
                {new Date(paste.created).toLocaleString()}
              </time>
              <div className="files-actions">
                <button
                  className="button"
                  aria-label="Copy paste"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(paste.text);
                      setMessage('Paste copied.');
                    } catch {
                      setError(
                        'Unable to copy. Select the text and copy it manually.',
                      );
                    }
                  }}
                >
                  <Copy size={16} /> Copy
                </button>
                <button
                  className="icon-button files-error"
                  aria-label="Delete paste"
                  onClick={() => setRemove(paste.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <pre tabIndex={0}>{paste.text}</pre>
            {remove === paste.id && (
              <div className="files-actions">
                <span>Delete this paste permanently?</span>
                <button className="button" onClick={() => setRemove(null)}>
                  Keep it
                </button>
                <button
                  className="button files-error"
                  disabled={pending > 0}
                  onClick={async () => {
                    setPending((count) => count + 1);
                    try {
                      await request(
                        `pastes?id=${encodeURIComponent(paste.id)}`,
                        'DELETE',
                      );
                      setPastes((current) =>
                        current.filter((entry) => entry.id !== paste.id),
                      );
                      setRemove(null);
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setPending((count) => count - 1);
                    }
                  }}
                >
                  Delete permanently
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
