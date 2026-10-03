import { useEffect, useState } from 'react';
import {
  Grid2X2,
  LayoutDashboard,
  Plus,
  Settings2,
  ShieldCheck,
  Container,
} from 'lucide-react';
import type { Config } from '../lib/schema';
import type { PublicUser } from '../lib/auth';
import type { ContainerManager } from '../lib/container-managers';

export default function AppSidebar({
  config: initialConfig,
  user,
  managers = [],
  boardId,
  managerId,
  settings = false,
  onBoard,
  onManager,
}: {
  config: Config;
  user: PublicUser;
  managers?: ContainerManager[];
  boardId?: string;
  managerId?: string;
  settings?: boolean;
  onBoard?: (id: string) => void;
  onManager?: (manager: ContainerManager) => void;
}) {
  const [config, setConfig] = useState(initialConfig);
  useEffect(() => setConfig(initialConfig), [initialConfig]);
  useEffect(() => {
    const updated = (event: Event) =>
      setConfig((event as CustomEvent<Config>).detail);
    document.addEventListener('directory:config-saved', updated);
    return () =>
      document.removeEventListener('directory:config-saved', updated);
  }, []);
  return (
    <>
      <a className="brand" href="/" aria-label="The Directory home">
        <span className="brand-icon">
          <Grid2X2 size={20} />
        </span>
        <span>
          the directory<span className="brand-period">.</span>
        </span>
      </a>
      <div className="sidebar-workspace">
        <span className="dot" />
        {config.title}
      </div>
      <div className="nav-label">BOARDS</div>
      <nav aria-label="Boards">
        {config.boards.map((board) => {
          const active = !settings && !managerId && boardId === board.id;
          const content = (
            <>
              <LayoutDashboard size={18} />
              <span>{board.name}</span>
            </>
          );
          return onBoard ? (
            <button
              key={board.id}
              className={`nav-item ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onBoard(board.id)}
            >
              {content}
            </button>
          ) : (
            <a
              key={board.id}
              className="nav-item"
              href={`/?board=${encodeURIComponent(board.id)}`}
            >
              {content}
            </a>
          );
        })}
        {user.role === 'admin' && (
          <a className="nav-item subdued" href="/settings?section=boards">
            <Plus size={17} />
            <span>New board</span>
          </a>
        )}
      </nav>
      {managers.some((manager) => manager.url) && (
        <>
          <div className="sidebar-separator" />
          <div className="nav-label">CONTAINERS</div>
          <nav aria-label="Container managers">
            {managers
              .filter((manager) => manager.url)
              .map((manager) =>
                onManager ? (
                  <button
                    key={manager.id}
                    className={`nav-item ${managerId === manager.id ? 'active' : ''}`}
                    aria-current={managerId === manager.id ? 'page' : undefined}
                    onClick={() => onManager(manager)}
                  >
                    <Container size={18} />
                    <span>{manager.name}</span>
                  </button>
                ) : (
                  <a
                    key={manager.id}
                    className="nav-item"
                    href={`/?manager=${manager.id}`}
                  >
                    <Container size={18} />
                    <span>{manager.name}</span>
                  </a>
                ),
              )}
          </nav>
        </>
      )}
      <div className="sidebar-bottom">
        <a
          className={`nav-item ${settings ? 'active' : ''}`}
          href={user.role === 'admin' ? '/settings' : '/account'}
          aria-current={settings ? 'page' : undefined}
        >
          <Settings2 size={18} />
          <span>Settings</span>
        </a>
        <div className="sidebar-security">
          <ShieldCheck size={14} />
          <span>Private workspace</span>
        </div>
        <a className="profile" href="/account">
          <span className="avatar">
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <span className="profile-name">
            {user.username}
            <small>{user.role === 'admin' ? 'Administrator' : 'Viewer'}</small>
          </span>
        </a>
      </div>
    </>
  );
}
