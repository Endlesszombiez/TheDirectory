import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Board, BoardModule, Config, Service } from '../lib/schema';
import { boardModules, moveModule } from '../lib/board-layout';
import { clientId } from '../lib/client-id';
import type { Status } from './Dashboard';

type WidgetModule = Extract<BoardModule, { kind: 'widget' }>;
const catalog: Record<WidgetModule['widget'], [string, string]> = {
  health: [
    'Service health',
    'Live availability and response times for this board.',
  ],
  system: [
    'Host metrics',
    'Memory, CPU cores, and uptime of the dashboard host.',
  ],
  clock: ['Clock', 'Local time and date at a glance.'],
  notes: [
    'Board notes',
    'Keep connection details and reminders close at hand.',
  ],
  checklist: [
    'Checklist',
    'Track maintenance tasks with a shared, saved checklist.',
  ],
  timer: ['Focus timer', 'A 25-minute timer for your next task.'],
  docker: ['Docker', 'Container states from your Docker connection.'],
  uplinks: ['Uplinks', 'Metrics from your connected hosts.'],
};

export default function ModularBoard({
  board,
  columns,
  services,
  editing,
  canEdit,
  saving,
  status,
  statusError,
  renderService,
  renderWidget,
  healthKey,
  onSave,
}: {
  board: Board;
  columns: number;
  services: Service[];
  editing: boolean;
  canEdit: boolean;
  saving: boolean;
  status: Status | null;
  statusError: boolean;
  renderService: (service: Service) => ReactNode;
  renderWidget: (widget: Config['widgets'][number]) => ReactNode;
  healthKey: (service: Service) => string;
  onSave: (items: BoardModule[]) => Promise<boolean>;
}) {
  const items = boardModules(board);
  const [picker, setPicker] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [selected, setSelected] = useState<WidgetModule['widget'] | 'spacer'>(
    'health',
  );
  const visible = new Set(services.map((service) => service.id));
  const update = (id: string, change: Partial<BoardModule>) =>
    onSave(
      items.map((item) =>
        item.id === id ? ({ ...item, ...change } as BoardModule) : item,
      ),
    );
  const filtered = services.length !== board.services.length;
  return (
    <>
      {editing && (
        <div className="module-toolbar">
          <div>
            <strong>Make room for your workflow</strong>
            <p>
              Drag modules or use the arrows. Blank spaces stay where you place
              them.
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => setPicker(!picker)}
            aria-expanded={picker}
          >
            <Plus size={16} />
            Add widget or space
          </button>
        </div>
      )}
      {editing && picker && (
        <section className="module-picker" aria-label="Widget library">
          <div className="module-catalog">
            {Object.entries(catalog).map(([key, [name, description]]) => (
              <button
                key={key}
                className={`module-choice ${selected === key ? 'selected' : ''}`}
                onClick={() => setSelected(key as WidgetModule['widget'])}
                aria-pressed={selected === key}
              >
                <strong>{name}</strong>
                <span>{description}</span>
              </button>
            ))}
            <button
              className={`module-choice ${selected === 'spacer' ? 'selected' : ''}`}
              onClick={() => setSelected('spacer')}
              aria-pressed={selected === 'spacer'}
            >
              <strong>Blank space</strong>
              <span>Reserve a grid cell for breathing room.</span>
            </button>
          </div>
          <div className="module-picker-actions">
            <button className="button" onClick={() => setPicker(false)}>
              Close
            </button>
            <button
              className="button primary"
              disabled={saving || items.length >= 200}
              onClick={async () => {
                const base = { id: clientId(), span: 1 };
                const item: BoardModule =
                  selected === 'spacer'
                    ? { ...base, kind: 'spacer' }
                    : { ...base, kind: 'widget', widget: selected };
                if (await onSave([...items, item])) setPicker(false);
              }}
            >
              Add{' '}
              {selected === 'spacer'
                ? 'blank space'
                : catalog[selected][0].toLowerCase()}
            </button>
          </div>
        </section>
      )}
      {!items.length && (
        <div className="empty-state">
          <Plus size={28} />
          <h3>Your board, your layout</h3>
          <p>
            {canEdit
              ? 'Add a service, then use Edit to add widgets and blank spaces.'
              : 'This board is ready for services and widgets.'}
          </p>
        </div>
      )}
      {filtered && !services.length && (
        <p className="widget-caption">
          No matching services. Your widgets and layout remain in place.
        </p>
      )}
      <div
        className={`module-grid ${editing ? 'is-editing' : ''}`}
        style={{ '--columns': columns } as CSSProperties}
        aria-label="Board modules"
      >
        {items.map((item, index) => {
          const service =
            item.kind === 'service'
              ? services.find((service) => service.id === item.serviceId)
              : undefined;
          // Keep a filtered card's grid position so search does not rearrange the board.
          const hidden =
            item.kind === 'service' && !visible.has(item.serviceId);
          const label =
            item.kind === 'service'
              ? service?.name || 'Service'
              : item.kind === 'spacer'
                ? 'Blank space'
                : catalog[item.widget][0];
          return (
            <div
              key={item.id}
              className={`board-module ${item.kind === 'spacer' || hidden ? 'module-space' : ''} ${target === item.id ? 'drop-target' : ''} ${dragged === item.id ? 'is-dragging' : ''}`}
              style={{ '--span': item.span } as CSSProperties}
              onDragOver={(event) => {
                if (dragged && editing && !saving && !filtered) {
                  event.preventDefault();
                  setTarget(item.id);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged && editing && !saving && !filtered)
                  void onSave(
                    moveModule(
                      items,
                      items.findIndex((other) => other.id === dragged),
                      index,
                    ),
                  );
                setDragged(null);
                setTarget(null);
              }}
            >
              {editing && (
                <div className="module-controls">
                  <button
                    className="module-grip icon-button"
                    draggable={!saving && !filtered}
                    disabled={saving || filtered}
                    aria-label={`Drag ${label}`}
                    title="Drag to move"
                    onDragStart={(event) => {
                      setDragged(item.id);
                      event.dataTransfer.setData('text/plain', item.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setTarget(null);
                    }}
                  >
                    <GripVertical size={15} />
                  </button>
                  <span>{label}</span>
                  <button
                    className="icon-button"
                    aria-label={`Move ${label} earlier`}
                    disabled={saving || filtered || index === 0}
                    onClick={() =>
                      void onSave(moveModule(items, index, index - 1))
                    }
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${label} later`}
                    disabled={saving || filtered || index === items.length - 1}
                    onClick={() =>
                      void onSave(moveModule(items, index, index + 1))
                    }
                  >
                    <ArrowRight size={14} />
                  </button>
                  <select
                    aria-label={`Width of ${label}`}
                    value={item.span}
                    disabled={saving}
                    onChange={(event) =>
                      void update(item.id, { span: Number(event.target.value) })
                    }
                  >
                    {Array.from({ length: columns }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1} col
                      </option>
                    ))}
                    {item.span > columns && (
                      <option value={item.span}>{item.span} col</option>
                    )}
                  </select>
                  {item.kind !== 'service' && (
                    <button
                      className="icon-button"
                      aria-label={`Remove ${label}`}
                      disabled={saving}
                      onClick={() =>
                        void onSave(
                          items.filter((other) => other.id !== item.id),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
              {hidden ? null : item.kind === 'service' ? (
                service && renderService(service)
              ) : item.kind === 'spacer' ? (
                editing && <div className="space-caption">Blank space</div>
              ) : item.widget === 'health' ? (
                <section className="widget module-health">
                  <div className="widget-heading">
                    <h3>Service health</h3>
                    <span className="live-label">30s</span>
                  </div>
                  {statusError && (
                    <p role="status">
                      Updates unavailable. Values may be stale.
                    </p>
                  )}
                  {!board.services.some((s) => s.check) && (
                    <p className="widget-caption">
                      Enable health checks on a service to see availability
                      here.
                    </p>
                  )}
                  {board.services
                    .filter((s) => s.check)
                    .map((s) => {
                      const health = status?.services[healthKey(s)];
                      return (
                        <div className="metric-row" key={s.id}>
                          <span>{s.name}</span>
                          <strong
                            className={`service-status ${health?.state || 'pending'}`}
                          >
                            <span className="dot" />
                            {health?.state === 'up'
                              ? `${health.latency ?? '—'} ms`
                              : health?.state === 'down'
                                ? 'Offline'
                                : health?.state === 'unchecked'
                                  ? 'Unchecked'
                                  : 'Checking…'}
                          </strong>
                        </div>
                      );
                    })}
                </section>
              ) : item.widget === 'notes' ? (
                <ModuleNote
                  text={item.text ?? board.notes}
                  canEdit={canEdit}
                  saving={saving}
                  onSave={(text) => update(item.id, { text })}
                />
              ) : item.widget === 'timer' ? (
                <FocusTimer />
              ) : item.widget === 'checklist' ? (
                <Checklist
                  key={item.id}
                  text={item.text || ''}
                  canEdit={canEdit}
                  saving={saving}
                  onSave={(text) => update(item.id, { text })}
                />
              ) : (
                renderWidget(item.widget)
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Checklist({
  text,
  canEdit,
  saving,
  onSave,
}: {
  text: string;
  canEdit: boolean;
  saving: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(text), [text]);
  const lines = text.split('\n').filter(Boolean);
  return (
    <section className="widget module-checklist">
      <div className="widget-heading">
        <h3>Checklist</h3>
        <span className="count">
          {lines.filter((line) => line.startsWith('[x] ')).length}/
          {lines.length}
        </span>
      </div>
      {editing ? (
        <>
          <textarea
            aria-label="Checklist tasks, one per line"
            maxLength={10000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="module-picker-actions">
            <button
              className="text-button"
              onClick={() => {
                setDraft(text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              className="text-button"
              disabled={saving}
              onClick={async () => {
                if (await onSave(draft)) setEditing(false);
              }}
            >
              Save tasks
            </button>
          </div>
        </>
      ) : (
        <>
          {!lines.length && (
            <p className="widget-caption">
              Add one task per line to plan your next maintenance session.
            </p>
          )}
          {lines.map((line, index) => (
            <label key={index} className="module-task">
              <input
                type="checkbox"
                disabled={!canEdit || saving}
                checked={line.startsWith('[x] ')}
                onChange={() => {
                  const next = [...lines];
                  next[index] = line.startsWith('[x] ')
                    ? line.slice(4)
                    : `[x] ${line}`;
                  void onSave(next.join('\n'));
                }}
              />
              <span>{line.replace(/^\[x\] /, '')}</span>
            </label>
          ))}
          {canEdit && (
            <button
              className="text-button"
              disabled={saving}
              onClick={() => setEditing(true)}
            >
              Edit tasks
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FocusTimer() {
  const [remaining, setRemaining] = useState(25 * 60);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (!left) setDeadline(null);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return (
    <section className="widget">
      <div className="widget-heading">
        <h3>Focus timer</h3>
        <span className="live-label">25 MIN</span>
      </div>
      <div className="focus-time" role="timer" aria-label="Time remaining">
        {Math.floor(remaining / 60)
          .toString()
          .padStart(2, '0')}
        :{(remaining % 60).toString().padStart(2, '0')}
      </div>
      <p className="widget-caption" role="status">
        {remaining === 0
          ? 'Session complete. Time for a break.'
          : deadline
            ? 'One task at a time.'
            : 'Ready when you are.'}
      </p>
      <div className="module-picker-actions">
        <button
          className="button"
          onClick={() => {
            setDeadline(null);
            setRemaining(1500);
          }}
        >
          Reset
        </button>
        <button
          className="button primary"
          disabled={remaining === 0}
          onClick={() =>
            setDeadline(deadline ? null : Date.now() + remaining * 1000)
          }
        >
          {deadline ? 'Pause' : 'Start'}
        </button>
      </div>
    </section>
  );
}

function ModuleNote({
  text,
  canEdit,
  saving,
  onSave,
}: {
  text: string;
  canEdit: boolean;
  saving: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <section className="widget notes-widget">
      <div className="widget-heading">
        <h3>Notes</h3>
      </div>
      <textarea
        aria-label="Widget notes"
        readOnly={!canEdit}
        maxLength={10000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Connection details, ideas, reminders…"
      />
      <div className="notes-footer">
        <span>{draft === text ? 'Saved' : 'Unsaved changes'}</span>
        {canEdit && (
          <button
            className="text-button"
            disabled={saving || draft === text}
            onClick={() => void onSave(draft)}
          >
            Save note
          </button>
        )}
      </div>
    </section>
  );
}
