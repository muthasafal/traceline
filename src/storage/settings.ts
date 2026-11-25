import { kvs } from '@forge/kvs';
import { ArtifactKind, Relation } from '../domain/types';

export interface Settings {
  pack: 'iec62304' | 'iso26262' | 'do178c';
  /** Integrity level used when an artifact has none. */
  defaultLevel: string;
  /** Levels at which the workflow validator blocks "Done" without a passing verification. */
  validatorLevels: string[];
  validatorEnabled: boolean;
  /** Jira issue type names per kind (case-insensitive). */
  issueTypes: Partial<Record<ArtifactKind, string[]>>;
  /** Jira label that marks an issue as a kind, used when issue types are not set up. */
  kindLabels: Partial<Record<ArtifactKind, string>>;
  /** Confluence page labels per kind. */
  pageLabels: Partial<Record<ArtifactKind, string>>;
  /** Jira issue link type names per relation. */
  linkTypes: Record<Relation, string>;
  /** Jira project keys Traceline watches. Empty means every project. */
  projects: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  pack: 'iec62304',
  defaultLevel: 'C',
  validatorLevels: ['B', 'C'],
  validatorEnabled: true,
  issueTypes: {
    SRS: ['Requirement', 'Software Requirement'],
    HAZ: ['Hazard'],
    RC: ['Risk Control'],
    VER: ['Test', 'Test Case'],
    IMP: ['Story', 'Task', 'Bug', 'Sub-task', 'Subtask'],
  },
  kindLabels: { SRS: 'tl-requirement', HAZ: 'tl-hazard', RC: 'tl-risk-control', VER: 'tl-test', IMP: 'tl-implementation' },
  pageLabels: { SYS: 'sys-req', SRS: 'sw-req', DES: 'design' },
  linkTypes: {
    implements: 'Implements',
    verifies: 'Verifies',
    mitigates: 'Mitigates',
    derives: 'Derives',
    designs: 'Designs',
  },
  projects: [],
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = (await kvs.get<Partial<Settings>>(KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...stored, linkTypes: { ...DEFAULT_SETTINGS.linkTypes, ...(stored.linkTypes ?? {}) } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await kvs.set(KEY, next);
  return next;
}

export async function getState<T>(key: string): Promise<T | undefined> {
  return (await kvs.get<T>(`state:${key}`)) ?? undefined;
}

export async function setState<T>(key: string, value: T): Promise<void> {
  await kvs.set(`state:${key}`, value as never);
}
