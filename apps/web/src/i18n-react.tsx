import { useMemo, type ReactNode } from 'react';
import type { WorkspaceLanguage } from '@utm/core';
import { translateInterfaceText } from './i18n';

export type Translate = (key: string) => string;

/** Translates interface-owned copy while React renders it. */
export function useTranslation(language: WorkspaceLanguage): Translate {
  return useMemo(() => (key: string) => translateInterfaceText(key, language), [language]);
}

/** Marks workspace-owned text so the transitional DOM translator cannot mutate it. */
export function UserDataText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className} translate="no" data-utm-user-data>{children}</span>;
}
