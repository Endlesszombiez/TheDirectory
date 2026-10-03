import {
  Palette,
  PanelsTopLeft,
  Plug,
  Users,
  UserRound,
  Archive,
} from 'lucide-react';

export default function SettingsNav({
  active,
  admin,
}: {
  active: string;
  admin: boolean;
}) {
  const items = [
    {
      id: 'appearance',
      label: 'Appearance',
      href: '/settings',
      icon: Palette,
      admin: true,
    },
    {
      id: 'boards',
      label: 'Boards',
      href: '/settings?section=boards',
      icon: PanelsTopLeft,
      admin: true,
    },
    { id: 'connections', label: 'Connections', href: '/ai', icon: Plug },
    { id: 'users', label: 'Users', href: '/users', icon: Users, admin: true },
    { id: 'account', label: 'Account', href: '/account', icon: UserRound },
    {
      id: 'backup',
      label: 'Backup',
      href: '/settings?section=backup',
      icon: Archive,
      admin: true,
    },
  ];
  return (
    <nav className="settings-nav" aria-label="Settings">
      {items
        .filter((item) => admin || !item.admin)
        .map(({ id, label, href, icon: Icon }) => (
          <a
            key={id}
            href={href}
            className={active === id ? 'active' : ''}
            aria-current={active === id ? 'page' : undefined}
          >
            <Icon size={17} />
            <span>{label}</span>
          </a>
        ))}
    </nav>
  );
}
