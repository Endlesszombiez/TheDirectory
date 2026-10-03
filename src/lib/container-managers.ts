export type ContainerManager = {
  id: 'portainer' | 'dockhand';
  name: string;
  envKey: string;
  url: string | null;
  error: string | null;
};

// Read at request time so deployed containers can configure these without rebuilding.
export function readContainerManagers(
  env: Record<string, string | undefined> = process.env,
): ContainerManager[] {
  return [
    {
      id: 'portainer' as const,
      name: 'Portainer',
      envKey: 'PORTAINER_HOME_URL',
    },
    { id: 'dockhand' as const, name: 'Dockhand', envKey: 'DOCKHAND_HOME_URL' },
  ].map((manager) => {
    const value = env[manager.envKey]?.trim();
    if (!value) return { ...manager, url: null, error: null };
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        throw new Error('Invalid URL');
      return { ...manager, url: url.href, error: null };
    } catch {
      return {
        ...manager,
        url: null,
        error:
          'Use a full http:// or https:// URL without embedded credentials.',
      };
    }
  });
}
