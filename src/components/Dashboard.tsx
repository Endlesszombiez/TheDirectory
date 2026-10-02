import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Cloud,
  Code2,
  Database,
  Download,
  Film,
  Globe,
  Grid2X2,
  Home,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
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
  Upload,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { configSchema, type Config, type Service } from '../lib/schema';
import type { PublicUser } from '../lib/auth';

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
  user,
}: {
  initialConfig: Config;
  user: PublicUser;
}) {
  const canEdit = user.role === 'admin';
  const [config, setConfig] = useState(initialConfig);
  const [boardId, setBoardId] = useState(initialConfig.boards[0].id);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [service, setService] = useState<Service | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mobile, setMobile] = useState(false);
  const [newBoard, setNewBoard] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialConfig.boards[0].notes);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
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
        setSettings(false);
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
        config.theme === 'light' ? '#f5f7f3' : '#101412',
      );
    document.title = `${config.title} · Homelab`;
  }, [config.theme, config.accent, config.title]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!settings && !service) return;
    const previous = document.activeElement as HTMLElement | null;
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
          '.modal button:not(:disabled), .modal input, .modal select, .modal textarea, .modal a[href]',
        ),
      );
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
      previous?.focus();
    };
  }, [settings, !!service]);

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
        setBoardId(next.boards[0].id);
    } catch {
      setError(
        'Invalid configuration file. Export a dashboard to see the supported format.',
      );
    }
    if (importRef.current) importRef.current.value = '';
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
  const greeting = !now
    ? 'Welcome home'
    : now.getHours() < 12
      ? 'Good morning'
      : now.getHours() < 18
        ? 'Good afternoon'
        : 'Good evening';

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
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <a className="brand" href="/" aria-label="The Directory home">
          <span className="brand-icon">
            <Grid2X2 size={21} />
          </span>
          <span>
            the directory<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">
            <Home size={18} />
          </span>
          <span>
            My homelab<small>Your personal workspace</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Boards">
          {config.boards.map((b, i) => (
            <button
              key={b.id}
              className={`nav-item ${board.id === b.id ? 'active' : ''}`}
              onClick={() => {
                setBoardId(b.id);
                setQuery('');
                setMobile(false);
              }}
            >
              <LayoutDashboard size={18} />
              <span>{b.name}</span>
              {i === 0 && (
                <span className="nav-count">{b.services.length}</span>
              )}
            </button>
          ))}
        </nav>
        {canEdit && (
          <>
            <button
              className="nav-item subdued"
              onClick={() => setSettings(true)}
            >
              <Plus size={18} />
              <span>Create a board</span>
            </button>
            <div className="sidebar-separator" />
            <div className="nav-label">MANAGE</div>
            <button
              className="nav-item"
              onClick={() => {
                setSettings(true);
              }}
            >
              <Settings2 size={18} />
              <span>Customization</span>
            </button>
            <button className="nav-item" onClick={exportConfig}>
              <Download size={18} />
              <span>Export dashboard</span>
            </button>
            <a className="nav-item" href="/users">
              <Shield size={18} />
              <span>People & permissions</span>
            </a>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="home-card">
            <span className="home-card-icon">
              <Server size={19} />
            </span>
            <strong>A place for everything.</strong>
            <p>
              Your lab. Your layout.
              <br />
              Your little corner of the web.
            </p>
            <span className="version">
              THE DIRECTORY <span>v0.1</span>
            </span>
          </div>
          <a className="profile" href="/account">
            <span className="avatar">
              {user.username.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {user.username}
              <small>{canEdit ? 'Administrator' : 'Viewer'} · My account</small>
            </span>
            <Settings2 size={16} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <Home size={15} />
            <span>/</span>
            <span>{board.name}</span>
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
            <a href="/account" className="avatar small" aria-label="My account">
              {user.username.slice(0, 2).toUpperCase()}
            </a>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" /> YOUR HOMELAB, AT A GLANCE
              </div>
              <h1>
                {greeting}
                <span className="greeting-dot">.</span>
              </h1>
              <p>{config.subtitle}</p>
            </div>
            <div className="heading-actions">
              {canEdit ? (
                <>
                  <button
                    className={`button ${editing ? 'selected' : ''}`}
                    onClick={() => setEditing(!editing)}
                  >
                    <Settings2 size={16} />
                    {editing ? 'Done editing' : 'Edit dashboard'}
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
          <div className="overview-strip">
            <span>
              <span className="dot" />
              {board.services.length} services in your directory
            </span>
            <span>
              <Activity size={14} />
              {checked.length
                ? `${up} of ${checked.length} checks healthy`
                : 'Health checks ready to configure'}
            </span>
            <span className="updated">
              <RefreshCw size={13} />
              {statusError
                ? 'Connection lost · retrying'
                : status
                  ? 'Updates every 30 seconds'
                  : 'Connecting to your lab…'}
            </span>
          </div>
          <div className="dashboard-layout">
            <section className="services-section" aria-label="Services">
              <div className="section-toolbar">
                <div className="section-title">
                  <Grid2X2 size={17} />
                  <h2>Your services</h2>
                  <span className="count">{services.length}</span>
                </div>
                <div className="search">
                  <Search size={16} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a service…"
                    aria-label="Find a service"
                  />
                  <kbd>⌘ K</kbd>
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
              {groups.map((group, groupIndex) => (
                <div className="service-group" key={group}>
                  <div className="group-heading">
                    <h3>{group}</h3>
                    <span>{String(groupIndex + 1).padStart(2, '0')}</span>
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
                        const health = status?.services[`${board.id}:${s.id}`];
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
                              if (!dragId || dragId === s.id || saving) return;
                              const list = [...board.services];
                              const from = list.findIndex(
                                (item) => item.id === dragId,
                              );
                              const to = list.findIndex(
                                (item) => item.id === s.id,
                              );
                              if (from < 0 || to < 0) return;
                              const [item] = list.splice(from, 1);
                              list.splice(to, 0, { ...item, group: s.group });
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
                              <p>{s.description || new URL(s.url).hostname}</p>
                              <div className="card-footer">
                                <span
                                  className={`service-status ${s.check ? health?.state || 'pending' : 'unchecked'}`}
                                >
                                  <span className="dot" />
                                  {!s.check
                                    ? 'Not monitored'
                                    : !health
                                      ? 'Checking…'
                                      : health.state === 'up'
                                        ? 'Online'
                                        : 'Unreachable'}
                                </span>
                                <span>
                                  {health?.latency !== undefined
                                    ? `${health.latency} ms`
                                    : new URL(s.url).hostname.replace(
                                        '.home',
                                        '',
                                      )}
                                </span>
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
                                    saving || board.services.at(-1)?.id === s.id
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
              {canEdit && (
                <>
                  <button
                    className="add-service-tile"
                    onClick={() => setService(blankService())}
                  >
                    <Plus size={18} />
                    <span>A new addition to your lab?</span>
                    <strong>Add a service</strong>
                    <ArrowUpRight size={15} />
                  </button>
                  <div className="tip">
                    <span>✦</span>
                    <p>
                      Make room for your favorites.{' '}
                      <button onClick={() => setSettings(true)}>
                        Customize your dashboard
                      </button>{' '}
                      to feel a little more like you.
                    </p>
                  </div>
                </>
              )}
            </section>
            {!!config.widgets.length && (
              <aside className="widgets" aria-label="Dashboard widgets">
                <div className="widget-section-label">
                  A LITTLE CONTEXT <MoreHorizontal size={17} />
                </div>
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
                      <div className="clock-bottom">
                        <span className="dot" />A good day to build something.
                      </div>
                    </section>
                  ) : widget === 'system' ? (
                    <section className="widget" key={widget}>
                      <div className="widget-heading">
                        <h3>
                          <Activity size={16} />
                          System overview
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
                            Dashboard host · {status?.system.platform || '—'}
                          </small>
                        </div>
                      </div>
                      <div className="metric-row">
                        <span>Memory</span>
                        <strong>
                          {status ? bytes(status.system.memoryUsed) : '—'}{' '}
                          <small>
                            / {status ? bytes(status.system.memoryTotal) : '—'}
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
                              : 'Meet your containers'}
                          </strong>
                          <p>
                            {status?.docker.error ||
                              'Connect a Docker socket to see your containers here.'}
                          </p>
                          <button
                            className="text-button"
                            disabled={!canEdit}
                            onClick={() => setSettings(true)}
                          >
                            Integration setup <ArrowUpRight size={13} />
                          </button>
                        </div>
                      )}
                    </section>
                  ) : (
                    <section className="widget notes-widget" key={widget}>
                      <div className="widget-heading">
                        <h3>
                          <StickyNote size={16} />
                          Scratchpad
                        </h3>
                        <Pencil size={14} />
                      </div>
                      <textarea
                        aria-label="Board notes"
                        readOnly={!canEdit}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="A thought, a reminder, a little note…"
                        maxLength={10000}
                      />
                      <div className="notes-footer">
                        <span>Just for this board</span>
                        <button
                          className="text-button"
                          disabled={!canEdit || notes === board.notes || saving}
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
          <footer className="page-footer">
            <span>
              <span className="footer-mark">
                <Grid2X2 size={13} />
              </span>
              {config.title}
              <span className="footer-divider">/</span> Your services. Your
              space.
            </span>
            <span>
              Built for life at home <Home size={12} />
            </span>
          </footer>
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <Check size={16} />
          {message}
        </div>
      )}
      {canEdit && (service || settings) && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setService(null);
              setSettings(false);
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
                <span className="eyebrow">MAKE IT YOURS</span>
                <h2 id="modal-title">
                  {service
                    ? board.services.some((s) => s.id === service.id)
                      ? 'Edit service'
                      : 'Add a service'
                    : 'Your dashboard'}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => {
                  setService(null);
                  setSettings(false);
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
            {service ? (
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
                    placeholder="What lives here?"
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
                    {[...new Set(board.services.map((s) => s.group))].map(
                      (g) => (
                        <option key={g} value={g} />
                      ),
                    )}
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
            ) : (
              <>
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
                    Welcome subtitle
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
                  <button
                    className="button primary full-width"
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save appearance'}
                  </button>
                </form>
                <div className="settings-section">
                  <h3>Boards</h3>
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
                            window.confirm(
                              `Delete ${b.name} and all its services?`,
                            )
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
                        setBoardId(id);
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
                <div className="settings-section">
                  <h3>Docker integration</h3>
                  <p>
                    Set <code>DOCKER_SOCKET=/var/run/docker.sock</code> and
                    mount the socket in your container. The dashboard only reads
                    container information. See the README for socket access and
                    permissions.
                  </p>
                  <p>
                    Service health checks use your saved URLs. Media, Proxmox,
                    and Home Assistant API integrations are planned; their
                    example cards are links.
                  </p>
                </div>
                <div className="settings-section">
                  <h3>Take your setup with you</h3>
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
          </section>
        </div>
      )}
    </div>
  );
}
