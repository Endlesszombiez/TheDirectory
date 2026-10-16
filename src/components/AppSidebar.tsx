import { useEffect, useState } from 'react';
import {
  Grid2X2,
  LayoutDashboard,
  Plus,
  Settings2,
  Star,
  FolderUp,
} from 'lucide-react';
import { useFavorites, favoriteKey, FAVORITES_BOARD } from '../lib/favorites';
import { serviceDestination, isLocalHostname } from '../lib/service-links';
import type { Config } from '../lib/schema';
import type { PublicUser } from '../lib/auth';
import type { ContainerManager } from '../lib/container-managers';

export default function AppSidebar({
  config: initialConfig,
  user,
  boardId,
  managerId,
  settings = false,
  files = false,
  onBoard,
}: {
  config: Config;
  user: PublicUser;
  managers?: ContainerManager[];
  boardId?: string;
  managerId?: string;
  settings?: boolean;
  files?: boolean;
  onBoard?: (id: string) => void;
  onManager?: (manager: ContainerManager) => void;
}) {
  const { favorites } = useFavorites(user.id);
  const [localAccess, setLocalAccess] = useState(false);
  useEffect(() => setLocalAccess(isLocalHostname(location.hostname)), []);
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
      <div className="nav-label">BOARDS</div>
      <nav aria-label="Boards">
        {[
          config.boards[0],
          { id: FAVORITES_BOARD, name: 'Favorites' },
          ...config.boards.slice(1),
        ].map((board) => {
          const active = !settings && !managerId && boardId === board.id;
          const content = (
            <>
              {board.id === FAVORITES_BOARD ? (
                <Star size={18} />
              ) : (
                <LayoutDashboard size={18} />
              )}
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
      <div className="sidebar-separator" />
      <div className="nav-label">FAVORITES</div>
      <nav aria-label="Favorite services">
        {config.boards.flatMap((board) =>
          board.services
            .filter((service) =>
              favorites.includes(favoriteKey(board.id, service.id)),
            )
            .map((service) => (
              <a
                className="nav-item"
                key={favoriteKey(board.id, service.id)}
                href={serviceDestination(service, localAccess)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{service.name}</span>
              </a>
            )),
        )}
        {!favorites.length && (
          <p className="favorites-hint">Star services to add shortcuts.</p>
        )}
      </nav>
      <div className="sidebar-bottom">
        <a
          className={`nav-item ${files ? 'active' : ''}`}
          href="/files"
          aria-current={files ? 'page' : undefined}
        >
          <FolderUp size={18} />
          <span>Files</span>
        </a>
        <a
          className={`nav-item ${settings ? 'active' : ''}`}
          href={user.role === 'admin' ? '/settings' : '/account'}
          aria-current={settings ? 'page' : undefined}
        >
          <Settings2 size={18} />
          <span>Settings</span>
        </a>
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
