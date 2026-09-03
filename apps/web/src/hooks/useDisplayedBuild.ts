import { useEffect, useState } from 'react';

const BUILD_COMMIT = (import.meta.env.VITE_COMMIT_SHA || 'local').slice(0, 7);

export function useDisplayedBuild(): { commit: string; dirty: boolean } {
  const [build, setBuild] = useState({ commit: BUILD_COMMIT, dirty: false });
  useEffect(() => {
    // A previously installed PWA shell can be served by the service worker even
    // while its URL points at Vite dev. The live endpoint remains authoritative.
    const refresh = () => void fetch('/__utm-build-info', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<{ commit?: string; dirty?: boolean }> : undefined)
      .then((result) => { if (result?.commit) setBuild({ commit: result.commit.slice(0, 7), dirty: Boolean(result.dirty) }); })
      .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, []);
  return build;
}

