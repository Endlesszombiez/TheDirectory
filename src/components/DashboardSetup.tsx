import { useEffect, useRef, useState } from 'react';
import {
  Container,
  Sparkles,
  X,
  Search,
  Check,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { configSchema, serviceSchema, type Config } from '../lib/schema';
import {
  importDiscoveredServices,
  normalizedServiceUrl,
} from '../lib/dashboard-setup';
import type { DiscoveredService } from '../lib/discovery';
import type { AIConnectionStatus } from '../lib/ai-connections';
import '../styles/setup.css';

type Props = {
  config: Config;
  boardId: string;
  saving: boolean;
  saveError?: string;
  onClose: () => void;
  onApply: (config: Config) => Promise<boolean>;
};
export default function DashboardSetup({
  config,
  boardId,
  saving,
  saveError,
  onClose,
  onApply,
}: Props) {
  const [tab, setTab] = useState<'discover' | 'prompt'>('discover');
  const [host, setHost] = useState('');
  const [mode, setMode] = useState('containers');
  const [target, setTarget] = useState(boardId);
  const [services, setServices] = useState<DiscoveredService[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [connection, setConnection] = useState<AIConnectionStatus | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<Config | null>(null);
  const abort = useRef<AbortController | null>(null);
  const activeAccount = connection?.accounts.find(
    (a) => a.active && a.connected,
  );
  const targetBoard =
    config.boards.find((b) => b.id === target) || config.boards[0];
  const existingUrls = new Set(
    targetBoard.services.map((s) => normalizedServiceUrl(s.url)),
  );
  const duplicate = (s: DiscoveredService) => {
    try {
      return existingUrls.has(normalizedServiceUrl(s.service.url));
    } catch {
      return false;
    }
  };
  const ready = (s: DiscoveredService) =>
    serviceSchema.safeParse(s.service).success && !duplicate(s);
  const importable =
    services?.filter((s) => selected.has(s.id) && ready(s)) || [];
  useEffect(() => {
    setHost(location.origin);
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    setPreview(null);
  }, [config.revision]);
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, init);
    const data = await response.json();
    if (response.status === 401 && data.error === 'Sign in required') {
      location.assign('/login');
      throw new Error('Please sign in again.');
    }
    if (!response.ok)
      throw new Error(data.error || 'Unable to complete the request.');
    return data;
  }
  async function discover() {
    setBusy(true);
    setError('');
    setMessage('');
    setServices(null);
    setSelected(new Set());
    try {
      const data = await request(
        `/api/discovery?${new URLSearchParams({ mode, host })}`,
      );
      setServices(data.services);
      setSelected(
        new Set(
          (data.services as DiscoveredService[]).filter(ready).map((s) => s.id),
        ),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importSelected() {
    setError('');
    try {
      const result = importDiscoveredServices(
        config,
        targetBoard.id,
        importable.map((s) => s.service),
      );
      if (!result.added) {
        setMessage('These services are already on the selected board.');
        return;
      }
      if (await onApply(result.config)) {
        setSelected(new Set());
        setMessage(
          `Imported ${result.added} service${result.added === 1 ? '' : 's'} into ${targetBoard.name}. You can now arrange them with a prompt.`,
        );
      }
    } catch {
      setError(
        'Unable to import. Check the service URLs and the limit of 100 services per board.',
      );
    }
  }
  async function loadAI() {
    setBusy(true);
    setError('');
    try {
      const connection = await request('/api/ai/connections');
      setConnection(connection);
      if (
        !connection.accounts.some(
          (a: AIConnectionStatus['accounts'][number]) =>
            a.active && a.connected,
        )
      ) {
        setModels([]);
        setModel('');
        return;
      }
      const data = await request('/api/ai/models');
      setModels(data.models);
      setModel((current) =>
        data.models.some((m: { id: string }) => m.id === current)
          ? current
          : data.models[0]?.id || '',
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (tab === 'prompt') void loadAI();
  }, [tab]);
  async function generate() {
    setBusy(true);
    setError('');
    setMessage('');
    setPreview(null);
    abort.current = new AbortController();
    try {
      const data = await request('/api/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, revision: config.revision }),
        signal: abort.current.signal,
      });
      setPreview(configSchema.parse(data.config));
    } catch (error) {
      if ((error as Error).name !== 'AbortError')
        setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || saving;
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !disabled) onClose();
      }}
    >
      <section
        className="modal setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="setup-title">Add services</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dashboard setup"
            disabled={disabled}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="setup-tabs" role="tablist" aria-label="Setup method">
          <button
            id="discover-tab"
            role="tab"
            aria-selected={tab === 'discover'}
            aria-controls="discover-panel"
            className={tab === 'discover' ? 'active' : ''}
            disabled={disabled}
            onClick={() => {
              setTab('discover');
              setError('');
              setMessage('');
            }}
          >
            <Container size={16} /> Discover services
          </button>
          <button
            id="prompt-tab"
            role="tab"
            aria-selected={tab === 'prompt'}
            aria-controls="prompt-panel"
            className={tab === 'prompt' ? 'active' : ''}
            disabled={disabled}
            onClick={() => {
              setTab('prompt');
              setError('');
              setMessage('');
            }}
          >
            <Sparkles size={16} /> AI setup
          </button>
        </div>
        {(error || saveError) && (
          <p className="alert" role="alert">
            {error || saveError}
          </p>
        )}
        {message && (
          <p className="setup-success" role="status">
            {message}
          </p>
        )}
        {tab === 'discover' ? (
          <div
            id="discover-panel"
            role="tabpanel"
            aria-labelledby="discover-tab"
          >
            <p className="setup-intro">
              Find Docker services, review their URLs, and choose what to add.
            </p>
            <form
              className="setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void discover();
              }}
            >
              <div className="form-row">
                <label>
                  Discovery source
                  <select
                    value={mode}
                    disabled={disabled}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="containers">Containers / Compose</option>
                    <option value="swarm">
                      Swarm services (manager required)
                    </option>
                  </select>
                </label>
                <label>
                  Import into board
                  <select
                    value={targetBoard.id}
                    disabled={disabled}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {config.boards.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Docker host address
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  required
                  type="url"
                  maxLength={2048}
                  placeholder="http://nas.home"
                  disabled={disabled}
                />
                <small>
                  Browser-accessible host address. Published ports are added
                  automatically.
                </small>
              </label>
              <button className="button primary" disabled={disabled}>
                <Search size={15} />{' '}
                {busy ? 'Discovering…' : 'Discover services'}
              </button>
            </form>
            {services && (
              <div className="discovery-results">
                <div className="discovery-heading">
                  <h3>
                    {services.length} service{services.length === 1 ? '' : 's'}{' '}
                    found
                  </h3>
                  <button
                    className="button"
                    disabled={disabled}
                    onClick={() =>
                      setSelected(
                        new Set(services.filter(ready).map((s) => s.id)),
                      )
                    }
                  >
                    Select available
                  </button>
                </div>
                {!services.length && (
                  <p className="setup-intro">
                    No services were found on this Docker endpoint.
                  </p>
                )}
                {services.map((candidate) => (
                  <article className="discovery-entry" key={candidate.id}>
                    <label className="discovery-select">
                      <input
                        type="checkbox"
                        checked={selected.has(candidate.id) && ready(candidate)}
                        disabled={disabled || !ready(candidate)}
                        onChange={(e) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (e.target.checked) next.add(candidate.id);
                            else next.delete(candidate.id);
                            return next;
                          })
                        }
                      />
                      <strong>{candidate.name}</strong>
                      <span className="discovery-state">{candidate.state}</span>
                    </label>
                    <p className="discovery-image">{candidate.image}</p>
                    <div className="setup-form">
                      <div className="form-row">
                        <label>
                          Card name
                          <input
                            aria-label={`Card name for ${candidate.name}`}
                            value={candidate.service.name}
                            maxLength={80}
                            disabled={disabled}
                            onChange={(e) =>
                              setServices((items) =>
                                items!.map((s) =>
                                  s.id === candidate.id
                                    ? {
                                        ...s,
                                        service: {
                                          ...s.service,
                                          name: e.target.value,
                                        },
                                      }
                                    : s,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Group
                          <input
                            aria-label={`Group for ${candidate.name}`}
                            value={candidate.service.group}
                            maxLength={50}
                            disabled={disabled}
                            onChange={(e) =>
                              setServices((items) =>
                                items!.map((s) =>
                                  s.id === candidate.id
                                    ? {
                                        ...s,
                                        service: {
                                          ...s.service,
                                          group: e.target.value,
                                        },
                                      }
                                    : s,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Browser URL
                        <input
                          aria-label={`Browser URL for ${candidate.name}`}
                          value={candidate.service.url}
                          placeholder="https://service.home"
                          type="url"
                          maxLength={2048}
                          disabled={disabled}
                          onChange={(e) =>
                            setServices((items) =>
                              items!.map((s) =>
                                s.id === candidate.id
                                  ? {
                                      ...s,
                                      service: {
                                        ...s.service,
                                        url: e.target.value,
                                      },
                                    }
                                  : s,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <p className="discovery-reason">
                      {duplicate(candidate)
                        ? 'Already on this board.'
                        : candidate.reason}
                    </p>
                  </article>
                ))}
                {!!services.length && (
                  <div className="setup-footer">
                    <p>
                      {importable.length} selected · Health checks start
                      disabled.
                    </p>
                    <button
                      className="button primary"
                      disabled={disabled || !importable.length}
                      onClick={() => void importSelected()}
                    >
                      <Check size={15} />{' '}
                      {saving ? 'Importing…' : 'Import selected'}
                    </button>
                  </div>
                )}
              </div>
            )}
            <p className="setup-help-link">
              Connect a Docker socket or restricted proxy in your deployment to
              enable discovery. Each endpoint covers one daemon, or its Swarm
              when connected to a manager.
            </p>
          </div>
        ) : (
          <div id="prompt-panel" role="tabpanel" aria-labelledby="prompt-tab">
            <p className="setup-intro">
              Describe the layout you want. AI can organize your existing
              services into boards and groups, update card names and icons, and
              adjust the dashboard’s appearance.
            </p>
            {busy && !connection && (
              <p role="status">Loading your OpenAI API key connection…</p>
            )}
            {connection && !activeAccount && (
              <div className="setup-help">
                <h3>Use your own OpenAI API key</h3>
                <p>
                  Add an OpenAI API key in AI settings, then return here.
                  Service discovery and manual setup remain available.
                </p>
                <a className="button primary" href="/ai">
                  Open AI settings <ArrowRight size={15} />
                </a>
                <button
                  className="button"
                  disabled={disabled}
                  onClick={() => void loadAI()}
                >
                  <RefreshCw size={14} /> Refresh connection
                </button>
              </div>
            )}
            {activeAccount && (
              <>
                <div className="setup-account">
                  <span>
                    <Check size={14} /> Using {activeAccount.label}
                  </span>
                  <a href="/ai">Manage connection</a>
                </div>
                <form
                  className="setup-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void generate();
                  }}
                >
                  <label>
                    Model
                    <select
                      value={model}
                      disabled={disabled || !models.length}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      {models.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!models.length && !busy && (
                    <p>
                      No available models were returned.{' '}
                      <button
                        className="button"
                        onClick={() => void loadAI()}
                        type="button"
                      >
                        Refresh models
                      </button>
                    </p>
                  )}
                  <label>
                    Your setup prompt
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      required
                      maxLength={4000}
                      rows={4}
                      disabled={disabled}
                      placeholder="Group my services into Media, Home, and Infrastructure. Use a dark theme with purple accents and three columns."
                    />
                  </label>
                  <p className="setup-disclosure">
                    This sends your prompt and dashboard service names, URLs,
                    and display settings to OpenAI using this key’s API billing.
                    URL credentials, query strings, and fragments are removed.
                    Board notes, custom CSS, and connection credentials are
                    excluded from the prompt.{' '}
                    <a
                      href="https://platform.openai.com/usage"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Manage usage ↗
                    </a>
                  </p>
                  <button
                    className="button primary"
                    disabled={disabled || !model || !prompt.trim()}
                  >
                    <Sparkles size={15} />{' '}
                    {busy
                      ? 'Creating your proposal…'
                      : 'Preview dashboard setup'}
                  </button>
                </form>
              </>
            )}
            {preview && (
              <section className="proposal-preview">
                <div className="discovery-heading">
                  <h3>Your proposed dashboard</h3>
                  <span className="role-badge">Preview</span>
                </div>
                <div className="proposal-appearance">
                  <strong>{preview.title}</strong>
                  <p>{preview.subtitle}</p>
                  <span>
                    {preview.theme} theme · {preview.accent} accents ·{' '}
                    {preview.columns} columns ·{' '}
                    {preview.compact ? 'compact' : 'comfortable'} spacing
                  </span>
                  <p>Widgets: {preview.widgets.join(', ') || 'none'}</p>
                </div>
                {preview.boards.map((b) => (
                  <article className="proposal-board" key={b.id}>
                    <h4>
                      {b.name} <span>{b.services.length} services</span>
                    </h4>
                    {b.notes && (
                      <p className="discovery-reason">
                        Existing board notes preserved.
                      </p>
                    )}
                    <div className="proposal-cards">
                      {b.services.map((s) => (
                        <div
                          className={`proposal-card proposal-${s.color}`}
                          key={s.id}
                        >
                          <strong>{s.name}</strong>
                          <span>
                            {s.group} · {s.icon}
                          </span>
                          <p>{s.description}</p>
                          <small>{s.url}</small>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                <div className="setup-footer">
                  <p>
                    Review the proposal before saving. Service URLs and health
                    checks are preserved.
                  </p>
                  <button
                    className="button"
                    disabled={disabled}
                    onClick={() => setPreview(null)}
                  >
                    Discard
                  </button>
                  <button
                    className="button primary"
                    disabled={disabled || preview.revision !== config.revision}
                    onClick={async () => {
                      if (await onApply(preview)) {
                        setPreview(null);
                        setMessage('Dashboard setup applied.');
                      }
                    }}
                  >
                    <Check size={15} /> {saving ? 'Applying…' : 'Apply setup'}
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
