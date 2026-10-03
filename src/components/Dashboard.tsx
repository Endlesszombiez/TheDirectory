import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Cloud,
  Code2,
  Database,
  Download,
  Film,
  Globe,
  Grid2X2,
  Home,
  Menu,
  Moon,
  Music,
  Plus,
  Search,
  Server,
  Settings2,
  Shield,
  Sun,
  Trash2,
  X,
  Play,
  Container,
  StickyNote,
  Clock3,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { type Config, type Service } from '../lib/schema';
import type { PublicUser } from '../lib/auth';
import DashboardSetup from './DashboardSetup';
import AppSidebar from './AppSidebar';
import { ContainerManagerView } from './ContainerManagers';
import type { ContainerManager } from '../lib/container-managers';

const icons = {
  server: Server,
  film: Film,
  play: Play,
  download: Download,
  home: Home,
  shield: Shield,
  cloud: Cloud,
  database: Database,
  activity: Activity,
  code: Code2,
  music: Music,
  globe: Globe,
};
type Status = {
  services: Record<
    string,
    { state: 'up' | 'down' | 'unchecked'; latency?: number; code?: number }
  >;
  system: {
    hostname: string;
    uptime: number;
    memoryUsed: number;
    memoryTotal: number;
    cpus: number;
    load: number;
    platform: string;
  };
  docker: {
    configured: boolean;
    error?: string;
    containers?: {
      id: string;
      name: string;
      image: string;
      state: string;
      status: string;
    }[];
  };
  checkedAt: string;
};
const blankService = (): Service => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  url: 'http://',
  icon: 'globe',
  color: 'mint',
  group: 'Infrastructure',
  check: false,
});
const bytes = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

export default function Dashboard({
  initialConfig,
  containerManagers,
  user,
}: {
  initialConfig: Config;
  containerManagers: ContainerManager[];
  user: PublicUser;
}) {
  const canEdit = user.role === 'admin';
  const [selectedManager, setSelectedManager] =
    useState<ContainerManager | null>(null);
  const [config, setConfig] = useState(initialConfig);
  const [boardId, setBoardId] = useState(initialConfig.boards[0].id);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [setup, setSetup] = useState(false);
  const [service, setService] = useState<Service | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mobile, setMobile] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialConfig.boards[0].notes);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshing = useRef(false);
  const board = config.boards.find((b) => b.id === boardId) || config.boards[0];
  const services = board.services.filter((s) =>
    `${s.name} ${s.description} ${s.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [...new Set(services.map((s) => s.group))];
  const checked = board.services.filter((s) => s.check);
  const up = checked.filter(
    (s) => status?.services[`${board.id}:${s.id}`]?.state === 'up',
  ).length;

  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch('/api/status');
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) throw new Error();
      setStatus(await response.json());
      setStatusError(false);
    } catch {
      setStatusError(true);
    } finally {
      refreshing.current = false;
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedBoard = params.get('board');
    if (initialConfig.boards.some((b) => b.id === requestedBoard))
      setBoardId(requestedBoard!);
    const requestedManager = containerManagers.find(
      (m) => m.id === params.get('manager') && m.url,
    );
    if (requestedManager) setSelectedManager(requestedManager);
    if (canEdit && params.get('setup') === 'discover') setSetup(true);
    void refresh();
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    const poll = setInterval(() => void refresh(), 30_000);
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setService(null);
        setSetup(false);
        setMobile(false);
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
      window.removeEventListener('keydown', key);
    };
  }, []);
  useEffect(() => {
    setNotes(board.notes);
  }, [board.id, board.notes]);
  useEffect(() => {
    document.documentElement.dataset.theme = config.theme;
    document.documentElement.dataset.accent = config.accent;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        config.theme === 'light' ? '#f4f6f8' : '#111417',
      );
    document.title = `${config.title} · Homelab`;
  }, [config.theme, config.accent, config.title]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!service && !setup) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>('.modal input, .modal button')
          ?.focus(),
      0,
    );
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.modal button:not(:disabled), .modal input:not(:disabled):not([hidden]), .modal select:not(:disabled), .modal textarea:not(:disabled), .modal a[href]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', trap);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [!!service, setup]);

  async function persist(next: Config) {
    if (!canEdit) return false;
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Unable to save dashboard');
      setConfig(data);
      setMessage('Changes saved');
      void refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  const updateBoard = (services: Service[]) => ({
    ...config,
    boards: config.boards.map((b) =>
      b.id === board.id ? { ...b, services } : b,
    ),
  });
  async function saveService(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service) return;
    const exists = board.services.some((s) => s.id === service.id);
    if (
      await persist(
        updateBoard(
          exists
            ? board.services.map((s) => (s.id === service.id ? service : s))
            : [...board.services, service],
        ),
      )
    )
      setService(null);
  }
  function move(id: string, direction: number) {
    const list = [...board.services];
    const index = list.findIndex((s) => s.id === id);
    const neighbor = index + direction;
    if (neighbor < 0 || neighbor >= list.length) return;
    [list[index], list[neighbor]] = [list[neighbor], list[index]];
    void persist(updateBoard(list));
  }
  const time =
    now?.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) || '--:--';

  return (
    <div
      className={`app-shell ${config.compact ? 'compact' : ''}`}
      style={
        config.backgroundUrl
          ? {
              backgroundImage: `linear-gradient(var(--backdrop), var(--backdrop)), url(${JSON.stringify(config.backgroundUrl)})`,
              backgroundSize: 'cover',
              backgroundAttachment: 'fixed',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {config.customCss && <style>{config.customCss}</style>}
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="dashboard-sidebar"
        className={`sidebar ${mobile ? 'open' : ''}`}
      >
        <AppSidebar
          config={config}
          user={user}
          managers={containerManagers}
          boardId={board.id}
          managerId={selectedManager?.id}
          onBoard={(id) => {
            setSelectedManager(null);
            setBoardId(id);
            setQuery('');
            setMobile(false);
          }}
          onManager={(manager) => {
            setSelectedManager(manager);
            setMobile(false);
            setEditing(false);
          }}
        />
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="dashboard-sidebar"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <Home size={15} />
            <span>/</span>
            <span>{selectedManager?.name || board.name}</span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="dot" />
              SELF-HOSTED
            </span>
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              title={
                canEdit
                  ? 'Change shared theme'
                  : 'Theme is managed by your administrator'
              }
              onClick={() =>
                void persist({
                  ...config,
                  theme: config.theme === 'dark' ? 'light' : 'dark',
                })
              }
              disabled={saving || !canEdit}
            >
              {config.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className={selectedManager ? 'manager-main' : undefined}>
          {selectedManager ? (
            <ContainerManagerView
              key={selectedManager.id}
              manager={selectedManager}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>{board.name}</h1>
                  {config.subtitle && <p>{config.subtitle}</p>}
                </div>
                <div className="heading-actions">
                  {canEdit ? (
                    <>
                      <button className="button" onClick={() => setSetup(true)}>
                        <Sparkles size={16} />
                        Discover
                      </button>
                      <button
                        className={`button ${editing ? 'selected' : ''}`}
                        onClick={() => setEditing(!editing)}
                      >
                        <Settings2 size={16} />
                        {editing ? 'Done' : 'Edit'}
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setService(blankService())}
                      >
                        <Plus size={17} />
                        Add service
                      </button>
                    </>
                  ) : (
                    <span className="viewer-label">Viewer access</span>
                  )}
                </div>
              </div>
              {error && (
                <div className="alert" role="alert">
                  {error}
                  <button
                    className="icon-button"
                    aria-label="Dismiss error"
                    onClick={() => setError('')}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div className="dashboard-layout">
                <section className="services-section" aria-label="Services">
                  <div className="section-toolbar">
                    <div className="section-title">
                      <Grid2X2 size={17} />
                      <h2>Services</h2>
                      <span className="count">{services.length}</span>
                    </div>
                    <span
                      className={`health-summary ${statusError || (status && up < checked.length) ? 'is-error' : checked.length && status ? 'is-healthy' : ''}`}
                      title="Health checks refresh every 30 seconds"
                    >
                      <span className="dot" />
                      {statusError
                        ? 'Connection lost'
                        : checked.length
                          ? status
                            ? `${up}/${checked.length} healthy`
                            : 'Checking…'
                          : 'Checks off'}
                    </span>
                    <div className="search">
                      <Search size={16} />
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Find a service…"
                        aria-label="Find a service"
                      />
                      <kbd>Ctrl K</kbd>
                    </div>
                  </div>
                  {canEdit && editing && (
                    <div className="edit-toolbar">
                      <p>Edit, reorder, or remove your service cards.</p>
                      <button
                        className="button"
                        disabled={saving || !board.services.length}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove all ${board.services.length} services from ${board.name}? This cannot be undone.`,
                            )
                          ) {
                            void persist(updateBoard([]));
                          }
                        }}
                      >
                        <Trash2 size={14} />
                        Remove all services
                      </button>
                    </div>
                  )}
                  {!services.length && (
                    <div className="empty-state">
                      <Search size={28} />
                      <h3>{query ? 'No services found' : 'A fresh start'}</h3>
                      <p>
                        {query
                          ? 'Try a different name or category.'
                          : 'Add your first service to make this board yours.'}
                      </p>
                      <button
                        className="button"
                        disabled={!query && !canEdit}
                        onClick={() =>
                          query ? setQuery('') : setService(blankService())
                        }
                      >
                        {query ? 'Clear search' : 'Add service'}
                      </button>
                    </div>
                  )}
                  {groups.map((group) => (
                    <div className="service-group" key={group}>
                      <div className="group-heading">
                        <h3>{group}</h3>
                        <div />
                      </div>
                      <div
                        className="service-grid"
                        style={
                          { '--columns': config.columns } as React.CSSProperties
                        }
                      >
                        {services
                          .filter((s) => s.group === group)
                          .map((s) => {
                            const Icon = icons[s.icon];
                            const health =
                              status?.services[`${board.id}:${s.id}`];
                            return (
                              <article
                                className={`service-card ${dragId === s.id ? 'dragging' : ''}`}
                                key={s.id}
                                draggable={editing && !saving}
                                onDragStart={(e) => {
                                  setDragId(s.id);
                                  e.dataTransfer.setData('text/plain', s.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => setDragId(null)}
                                onDragOver={(e) => {
                                  if (editing && dragId) e.preventDefault();
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (!dragId || dragId === s.id || saving)
                                    return;
                                  const list = [...board.services];
                                  const from = list.findIndex(
                                    (item) => item.id === dragId,
                                  );
                                  const to = list.findIndex(
                                    (item) => item.id === s.id,
                                  );
                                  if (from < 0 || to < 0) return;
                                  const [item] = list.splice(from, 1);
                                  list.splice(to, 0, {
                                    ...item,
                                    group: s.group,
                                  });
                                  setDragId(null);
                                  void persist(updateBoard(list));
                                }}
                              >
                                <a
                                  className="service-link"
                                  draggable={false}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <div className="card-top">
                                    <span className={`service-icon ${s.color}`}>
                                      <Icon size={24} />
                                    </span>
                                    <ArrowUpRight
                                      className="external-arrow"
                                      size={16}
                                    />
                                  </div>
                                  <h4>{s.name}</h4>
                                  {s.description && <p>{s.description}</p>}
                                  <div className="card-footer">
                                    <span className="service-host">
                                      {new URL(s.url).host}
                                    </span>
                                    {s.check && (
                                      <span
                                        className={`service-status ${health?.state || 'pending'}`}
                                        title={
                                          health?.latency !== undefined
                                            ? `${health.latency} ms`
                                            : undefined
                                        }
                                      >
                                        <span className="dot" />
                                        {!health
                                          ? 'Checking'
                                          : health.state === 'up'
                                            ? 'Online'
                                            : health.state === 'down'
                                              ? 'Offline'
                                              : 'Unchecked'}
                                      </span>
                                    )}
                                  </div>
                                </a>
                                {editing && (
                                  <div className="card-edit">
                                    <button
                                      aria-label={`Edit ${s.name}`}
                                      title={`Edit ${s.name}`}
                                      disabled={saving}
                                      onClick={() => setService({ ...s })}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      aria-label={`Move ${s.name} up`}
                                      title={`Move ${s.name} up`}
                                      disabled={
                                        saving || board.services[0].id === s.id
                                      }
                                      onClick={() => move(s.id, -1)}
                                    >
                                      <ArrowUp size={14} />
                                    </button>
                                    <button
                                      aria-label={`Move ${s.name} down`}
                                      title={`Move ${s.name} down`}
                                      disabled={
                                        saving ||
                                        board.services.at(-1)?.id === s.id
                                      }
                                      onClick={() => move(s.id, 1)}
                                    >
                                      <ArrowDown size={14} />
                                    </button>
                                    <button
                                      aria-label={`Delete ${s.name}`}
                                      title={`Remove ${s.name}`}
                                      disabled={saving}
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            `Remove ${s.name} from this board?`,
                                          )
                                        )
                                          void persist(
                                            updateBoard(
                                              board.services.filter(
                                                (item) => item.id !== s.id,
                                              ),
                                            ),
                                          );
                                      }}
                                    >
                                      <Trash2 size={14} />
                                      Remove
                                    </button>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </section>
                {!!config.widgets.length && (
                  <aside className="widgets" aria-label="Dashboard widgets">
                    <div className="widget-section-label">Host & notes</div>
                    {config.widgets.map((widget) =>
                      widget === 'clock' ? (
                        <section className="widget clock-widget" key={widget}>
                          <div className="widget-heading">
                            <span>LOCAL TIME</span>
                            <Clock3 size={15} />
                          </div>
                          <div className="clock-time">
                            {time}
                            <span className="clock-dot" />
                          </div>
                          <p>
                            {now?.toLocaleDateString([], {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                            }) || 'Your local time'}
                          </p>
                        </section>
                      ) : widget === 'system' ? (
                        <section className="widget" key={widget}>
                          <div className="widget-heading">
                            <h3>
                              <Activity size={16} />
                              Host
                            </h3>
                            <span className="live-label">LIVE</span>
                          </div>
                          <div className="system-name">
                            <span className="system-icon">
                              <Server size={18} />
                            </span>
                            <div>
                              <strong>
                                {status?.system.hostname || 'Connecting…'}
                              </strong>
                              <small>
                                Dashboard host ·{' '}
                                {status?.system.platform || '—'}
                              </small>
                            </div>
                          </div>
                          <div className="metric-row">
                            <span>Memory</span>
                            <strong>
                              {status ? bytes(status.system.memoryUsed) : '—'}{' '}
                              <small>
                                /{' '}
                                {status
                                  ? bytes(status.system.memoryTotal)
                                  : '—'}
                              </small>
                            </strong>
                          </div>
                          <div className="progress-track">
                            <div
                              style={{
                                width: `${status ? (status.system.memoryUsed / status.system.memoryTotal) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <div className="metric-row">
                            <span>CPU cores</span>
                            <strong>{status?.system.cpus ?? '—'}</strong>
                          </div>
                          <div className="metric-row">
                            <span>Host uptime</span>
                            <strong>
                              {status
                                ? `${Math.floor(status.system.uptime / 86400)}d ${Math.floor((status.system.uptime % 86400) / 3600)}h`
                                : '—'}
                            </strong>
                          </div>
                          <p className="widget-caption">
                            OS metrics; container limits may differ.
                          </p>
                        </section>
                      ) : widget === 'docker' ? (
                        <section className="widget" key={widget}>
                          <div className="widget-heading">
                            <h3>
                              <Container size={17} />
                              Docker
                            </h3>
                            <span className="count">
                              {status?.docker.containers?.length ?? '—'}
                            </span>
                          </div>
                          {status?.docker.containers ? (
                            <>
                              <div className="docker-summary">
                                <span className="dot" />
                                {
                                  status.docker.containers.filter(
                                    (c) => c.state === 'running',
                                  ).length
                                }{' '}
                                containers running
                              </div>
                              <div className="container-list">
                                {status.docker.containers.length === 0 && (
                                  <p className="widget-caption">
                                    No containers found.
                                  </p>
                                )}
                                {status.docker.containers.map((c) => (
                                  <div
                                    key={c.id}
                                    className="container-row"
                                    title={`${c.image} · ${c.status}`}
                                  >
                                    <Container size={14} />
                                    <span>{c.name}</span>
                                    <span
                                      className={`dot ${c.state === 'running' ? '' : 'muted-dot'}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="integration-empty">
                              <span className="integration-icon">
                                <Container size={24} />
                              </span>
                              <strong>
                                {status?.docker.error
                                  ? 'Connection unavailable'
                                  : 'Docker not connected'}
                              </strong>
                              <p>
                                {status?.docker.error ||
                                  'Connect Docker in Settings.'}
                              </p>
                              {canEdit && (
                                <a className="text-button" href="/ai">
                                  Connections <ArrowUpRight size={13} />
                                </a>
                              )}
                            </div>
                          )}
                        </section>
                      ) : (
                        <section className="widget notes-widget" key={widget}>
                          <div className="widget-heading">
                            <h3>
                              <StickyNote size={16} />
                              Notes
                            </h3>
                            <Pencil size={14} />
                          </div>
                          <textarea
                            aria-label="Board notes"
                            readOnly={!canEdit}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add a note…"
                            maxLength={10000}
                          />
                          <div className="notes-footer">
                            <span>Board notes</span>
                            <button
                              className="text-button"
                              disabled={
                                !canEdit || notes === board.notes || saving
                              }
                              onClick={() =>
                                void persist({
                                  ...config,
                                  boards: config.boards.map((b) =>
                                    b.id === board.id ? { ...b, notes } : b,
                                  ),
                                })
                              }
                            >
                              {saving
                                ? 'Saving…'
                                : notes === board.notes
                                  ? 'Saved'
                                  : 'Save note'}
                              <Check size={12} />
                            </button>
                          </div>
                        </section>
                      ),
                    )}
                  </aside>
                )}
              </div>
            </>
          )}
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <Check size={16} />
          {message}
        </div>
      )}
      {canEdit && setup && (
        <DashboardSetup
          config={config}
          boardId={board.id}
          saving={saving}
          saveError={error}
          onClose={() => setSetup(false)}
          onApply={async (next) => {
            if (await persist(next)) {
              if (!next.boards.some((b) => b.id === boardId))
                setBoardId(next.boards[0].id);
              return true;
            }
            return false;
          }}
        />
      )}
      {canEdit && service && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setService(null);
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <h2 id="modal-title">
                  {board.services.some((s) => s.id === service.id)
                    ? 'Edit service'
                    : 'Add service'}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => {
                  setService(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <form onSubmit={saveService}>
              <label>
                Name
                <input
                  required
                  maxLength={80}
                  value={service.name}
                  onChange={(e) =>
                    setService({ ...service, name: e.target.value })
                  }
                  placeholder="e.g. Jellyfin"
                />
              </label>
              <label>
                Description
                <input
                  maxLength={160}
                  value={service.description}
                  onChange={(e) =>
                    setService({ ...service, description: e.target.value })
                  }
                  placeholder="Optional description"
                />
              </label>
              <label>
                Service URL
                <input
                  required
                  type="url"
                  pattern="https?://.*"
                  value={service.url}
                  onChange={(e) =>
                    setService({ ...service, url: e.target.value })
                  }
                  placeholder="http://192.168.1.10:8096"
                />
              </label>
              <label>
                Category
                <input
                  required
                  list="groups"
                  maxLength={50}
                  value={service.group}
                  onChange={(e) =>
                    setService({ ...service, group: e.target.value })
                  }
                />
                <datalist id="groups">
                  {[...new Set(board.services.map((s) => s.group))].map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>
              <div className="form-row">
                <label>
                  Icon
                  <select
                    value={service.icon}
                    onChange={(e) =>
                      setService({
                        ...service,
                        icon: e.target.value as Service['icon'],
                      })
                    }
                  >
                    {Object.keys(icons).map((icon) => (
                      <option key={icon}>{icon}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Color
                  <select
                    value={service.color}
                    onChange={(e) =>
                      setService({
                        ...service,
                        color: e.target.value as Service['color'],
                      })
                    }
                  >
                    {['mint', 'purple', 'orange', 'blue', 'pink'].map(
                      (color) => (
                        <option key={color}>{color}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={service.check}
                  onChange={(e) =>
                    setService({ ...service, check: e.target.checked })
                  }
                />
                <span>
                  Check service health
                  <small>
                    The server checks this URL every 30 seconds while the
                    dashboard is open.
                  </small>
                </span>
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setService(null)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save service'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
