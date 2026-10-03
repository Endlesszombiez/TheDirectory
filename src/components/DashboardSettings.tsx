import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Plus, Trash2 } from 'lucide-react';
import { configSchema, type Config } from '../lib/schema';

export default function DashboardSettings({
  initialConfig,
  section,
}: {
  initialConfig: Config;
  section: 'appearance' | 'boards' | 'backup';
}) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newBoard, setNewBoard] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = config.theme;
    document.documentElement.dataset.accent = config.accent;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        config.theme === 'light' ? '#f4f6f8' : '#111417',
      );
  }, [config.theme, config.accent]);
  async function persist(next: Config) {
    if (saving) return false;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return false;
      }
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Unable to save settings.');
      setConfig(data);
      document.dispatchEvent(
        new CustomEvent('directory:config-saved', { detail: data }),
      );
      setMessage('Changes saved');
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function exportConfig() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'thedirectory.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importConfig(file?: File) {
    if (!file) return;
    if (file.size > 512_000) {
      setError('The import file is too large.');
      return;
    }
    try {
      const next = configSchema.parse(JSON.parse(await file.text()));
      if (
        !window.confirm(
          'Replace all boards and settings with this configuration?',
        )
      )
        return;
      if (await persist({ ...next, revision: config.revision }))
        window.location.reload();
    } catch {
      setError(
        'Invalid configuration file. Export a dashboard to see the supported format.',
      );
    }
    if (importRef.current) importRef.current.value = '';
  }
  return (
    <div className="preferences-form">
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-success" role="status">
          {message}
        </p>
      )}
      {section === 'appearance' && (
        <>
          <p className="settings-description">
            Shared across your dashboard and settings.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              await persist({
                ...config,
                title: String(form.get('title')),
                subtitle: String(form.get('subtitle')),
                compact: form.has('compact'),
                backgroundUrl: String(form.get('backgroundUrl')),
                customCss: String(form.get('customCss')),
                theme: form.get('theme') as Config['theme'],
                accent: form.get('accent') as Config['accent'],
                columns: Number(form.get('columns')),
                widgets: form.getAll('widgets') as Config['widgets'],
              });
            }}
          >
            <label>
              Dashboard name
              <input
                name="title"
                required
                defaultValue={config.title}
                maxLength={60}
              />
            </label>
            <label>
              Subtitle (optional)
              <input
                name="subtitle"
                defaultValue={config.subtitle}
                maxLength={160}
              />
            </label>
            <div className="form-row">
              <label>
                Appearance
                <select name="theme" defaultValue={config.theme}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label>
                Accent
                <select name="accent" defaultValue={config.accent}>
                  {['mint', 'blue', 'purple', 'orange'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Columns
                <select name="columns" defaultValue={config.columns}>
                  {[2, 3, 4].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="checkbox-label">
              <input
                name="compact"
                type="checkbox"
                defaultChecked={config.compact}
              />
              Compact service cards
            </label>
            <details className="settings-advanced">
              <summary>Background & custom CSS</summary>
              <label>
                Background image URL
                <input
                  name="backgroundUrl"
                  type="url"
                  pattern="https?://.*"
                  defaultValue={config.backgroundUrl}
                  placeholder="https://example.com/background.jpg"
                />
              </label>
              <label>
                Custom CSS
                <textarea
                  className="custom-css"
                  name="customCss"
                  defaultValue={config.customCss}
                  maxLength={12000}
                  placeholder=".service-card { border-radius: 16px; }"
                />
                <small>
                  Advanced: applies to everyone using this shared dashboard.
                </small>
              </label>
            </details>
            <fieldset>
              <legend>Widgets</legend>
              <div className="widget-options">
                {['clock', 'system', 'docker', 'notes'].map((w) => (
                  <label className="checkbox-label" key={w}>
                    <input
                      name="widgets"
                      type="checkbox"
                      value={w}
                      defaultChecked={config.widgets.includes(
                        w as Config['widgets'][number],
                      )}
                    />
                    {w}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="button primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save appearance'}
            </button>
          </form>
        </>
      )}
      {section === 'boards' && (
        <>
          {' '}
          <div className="settings-section">
            <p className="settings-description">
              Organize services into boards. Names save when you leave the
              field.
            </p>
            {config.boards.map((b) => (
              <div className="board-setting" key={b.id}>
                <input
                  aria-label={`Rename ${b.name}`}
                  defaultValue={b.name}
                  key={`${b.id}:${b.name}`}
                  maxLength={40}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== b.name)
                      void persist({
                        ...config,
                        boards: config.boards.map((item) =>
                          item.id === b.id ? { ...item, name } : item,
                        ),
                      });
                  }}
                />
                <button
                  className="icon-button"
                  aria-label={`Delete board ${b.name}`}
                  disabled={saving || config.boards.length === 1}
                  onClick={() => {
                    if (
                      window.confirm(`Delete ${b.name} and all its services?`)
                    )
                      void persist({
                        ...config,
                        boards: config.boards.filter(
                          (item) => item.id !== b.id,
                        ),
                      });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newBoard.trim()) return;
                const id = crypto.randomUUID();
                if (
                  await persist({
                    ...config,
                    boards: [
                      ...config.boards,
                      {
                        id,
                        name: newBoard.trim(),
                        services: [],
                        notes: '',
                      },
                    ],
                  })
                ) {
                  setNewBoard('');
                }
              }}
            >
              <input
                aria-label="New board name"
                placeholder="New board name"
                value={newBoard}
                maxLength={40}
                onChange={(e) => setNewBoard(e.target.value)}
              />
              <button
                className="button"
                disabled={saving || config.boards.length >= 12}
              >
                <Plus size={16} />
                Add
              </button>
            </form>
          </div>
        </>
      )}
      {section === 'backup' && (
        <>
          {' '}
          <div className="settings-section">
            <p className="settings-description">
              Export or restore boards and appearance. Accounts, sessions, and
              API keys are excluded.
            </p>
            <div className="form-row">
              <button className="button" onClick={exportConfig}>
                <Download size={15} />
                Export JSON
              </button>
              <button
                className="button"
                disabled={saving}
                onClick={() => importRef.current?.click()}
              >
                <Upload size={15} />
                Import JSON
              </button>
              <input
                ref={importRef}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(e) => void importConfig(e.target.files?.[0])}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
