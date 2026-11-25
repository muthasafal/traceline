import { edgeId } from './graph';
import { Artifact, ArtifactKind, Edge, Relation, VerificationResult } from './types';

/**
 * SAMPLE DATA. A fictional infusion pump controller used to demonstrate
 * Traceline on an empty site. It is not a real product, does not describe any
 * real company's device, and must not be used as design input.
 *
 * Deliberate problems, so the demo has something to find:
 *  - SRS-027 has no linked test                       (missing test)
 *  - VER-031 is failing                                (failing test on SRS-021)
 *  - HAZ-008 has no risk control                       (uncontrolled hazard)
 *  - RC-010 has no verification                        (unverified risk control)
 *  - SRS-030 has no detailed design                    (Class C design gap)
 *  - SRS-004 was edited after VER-004 passed           (the suspect link)
 */

export const SAMPLE_LABEL = 'traceline-sample';
export const SAMPLE_PROJECT_NAME = 'Sample: Infusion pump controller v2.3';
export const SAMPLE_RELEASE = 'v2.3';

export interface SampleItem {
  ref: string; // e.g. SRS-004; becomes the Traceline key prefix in titles
  kind: ArtifactKind;
  title: string;
  body: string;
  safetyClass?: string;
  result?: VerificationResult;
  /** Hazard fields. */
  severity?: string;
  probability?: string;
  paths?: string[];
}

export interface SampleLink {
  from: string; // downstream ref
  rel: Relation;
  to: string; // upstream ref
}

const SYS: [string, string][] = [
  ['Deliver a programmed infusion volume within ±5% of the set volume', 'Volume accuracy across the rated flow range.'],
  ['Support flow rates from 0.1 to 999 mL/h', 'Rate range for the primary channel.'],
  ['Detect downstream occlusion and stop infusion', 'Occlusion detection and safe stop.'],
  ['Detect air in line and stop infusion', 'Air-in-line detection.'],
  ['Alarm the user audibly and visually on any fault', 'Alarm system behaviour.'],
  ['Run from battery for at least 4 hours', 'Battery operation.'],
  ['Warn before the battery is depleted', 'Low-battery warning.'],
  ['Restrict programming to authorised users', 'User access control.'],
  ['Check programmed doses against a drug library', 'Dose error reduction.'],
  ['Record an event log of infusions and alarms', 'Event history for review.'],
  ['Resume safely after a power interruption', 'Power-loss recovery.'],
  ['Prevent free flow when the set is removed', 'Free-flow protection.'],
  ['Show infusion status on the display at all times', 'Status visibility.'],
  ['Let the user pause and resume an infusion', 'Pause and resume.'],
  ['Perform a self-test at power on', 'Power-on self-test.'],
];

/** [title, parent SYS index (1-based)] */
const SRS: [string, number][] = [
  ['Motor controller shall compute step rate from the programmed flow rate', 2],
  ['Volume delivered shall be integrated from motor steps every 100 ms', 1],
  ['Software shall stop the motor within 1 s of an occlusion signal', 3],
  ['Occlusion pressure threshold shall be configurable in three levels', 3],
  ['Software shall stop the motor within 1 s of an air-in-line signal', 4],
  ['Air bubbles above 50 µL shall raise an air-in-line alarm', 4],
  ['High-priority alarms shall sound at least 65 dBA', 5],
  ['Alarm state shall be shown with a red indicator and message', 5],
  ['Battery level shall be sampled every 10 s', 6],
  ['Low-battery warning shall appear at 30 minutes remaining', 7],
  ['Depleted-battery alarm shall stop infusion safely', 7],
  ['Programming mode shall require a 4-digit clinician PIN', 8],
  ['Drug library limits shall block doses above the hard limit', 9],
  ['Soft-limit overrides shall require confirmation', 9],
  ['Every alarm shall be written to the event log with a timestamp', 10],
  ['Event log shall retain at least 2,000 entries', 10],
  ['After power loss, software shall restore the last infusion in paused state', 11],
  ['Software shall not auto-resume after power loss', 11],
  ['Door-open signal shall close the pinch valve', 12],
  ['Display shall refresh infusion status every 1 s', 13],
  ['Pause shall stop the motor within 500 ms', 14],
  ['Resume shall require user confirmation', 14],
  ['Power-on self-test shall check RAM, ROM checksum and motor driver', 15],
  ['Failed self-test shall block infusion and show an error code', 15],
  ['Watchdog shall reset the controller if the main loop stalls for 2 s', 3],
  ['Flow rate entry shall reject values outside 0.1 to 999 mL/h', 2],
  ['Key bolus volume shall be limited by the drug library', 9],
  ['Alarm silence shall last at most 2 minutes', 5],
  ['Occlusion alarm shall be distinguishable from air-in-line alarm', 5],
  ['End-of-infusion shall switch to keep-vein-open rate', 1],
];

/** [title, severity, probability] */
const HAZ: [string, string, string][] = [
  ['Over-infusion due to incorrect motor rate', 'Critical', 'Remote'],
  ['Under-infusion due to undetected occlusion', 'Serious', 'Occasional'],
  ['Air embolism from undetected air in line', 'Critical', 'Remote'],
  ['Unnoticed alarm', 'Serious', 'Occasional'],
  ['Interrupted or unexpected infusion after a power event', 'Serious', 'Occasional'],
  ['Dose programming error', 'Critical', 'Probable'],
  ['Free flow when the set is removed', 'Critical', 'Remote'],
  ['Clinician acts on stale status shown on the display', 'Serious', 'Remote'],
];

/** [title, hazard index, implementing SRS indexes] */
const RC: [string, number, number[]][] = [
  ['Independent volume check against motor steps', 1, [2]],
  ['Rate limit check on every motor command', 1, [1, 26]],
  ['Occlusion detection with fast motor stop', 2, [3, 4]],
  ['Air-in-line detection with fast motor stop', 3, [5, 6]],
  ['Prioritised audible and visual alarms', 4, [7, 8, 29]],
  ['Low-battery warning and safe stop', 5, [10, 11]],
  ['Drug library hard and soft limits', 6, [13, 14, 27]],
  ['Pinch valve closes on door open', 7, [19]],
  ['Restore in paused state after power loss', 5, [17, 18]],
  ['Watchdog supervision of the main loop', 1, [25]],
];

/** Design items: [title, SRS indexes allocated] */
const DES: [string, number[]][] = [
  ['Motor control module', [1, 2, 26, 30]],
  ['Occlusion monitor', [3, 4]],
  ['Air-in-line monitor', [5, 6]],
  ['Alarm manager', [7, 8, 28, 29]],
  ['Power and battery manager', [9, 10, 11]],
  ['Access control', [12]],
  ['Drug library engine', [13, 14, 27]],
  ['Event logger', [15, 16]],
  ['Recovery manager', [17, 18]],
  ['Door and valve interlock', [19]],
  ['Display and UI controller', [20, 21, 22]],
  ['Self-test and watchdog', [23, 24, 25]],
];

const pad = (n: number) => String(n).padStart(3, '0');

export interface SampleProject {
  items: SampleItem[];
  links: SampleLink[];
  /** The SRS that will be edited after verification to create the suspect link. */
  suspectTarget: string;
}

export function buildSampleProject(): SampleProject {
  const items: SampleItem[] = [];
  const links: SampleLink[] = [];

  SYS.forEach(([t, b], i) => items.push({ ref: `SYS-${pad(i + 1)}`, kind: 'SYS', title: t, body: b, safetyClass: 'C' }));
  SRS.forEach(([t, sys], i) => {
    const ref = `SRS-${pad(i + 1)}`;
    items.push({ ref, kind: 'SRS', title: t, body: t + '.', safetyClass: 'C' });
    links.push({ from: ref, rel: 'derives', to: `SYS-${pad(sys)}` });
  });
  HAZ.forEach(([t, severity, probability], i) =>
    items.push({ ref: `HAZ-${pad(i + 1)}`, kind: 'HAZ', title: t, body: t + '.', severity, probability }),
  );
  RC.forEach(([t, haz, srs], i) => {
    const ref = `RC-${pad(i + 1)}`;
    items.push({ ref, kind: 'RC', title: t, body: t + '.', safetyClass: 'C' });
    links.push({ from: ref, rel: 'mitigates', to: `HAZ-${pad(haz)}` });
    for (const s of srs) links.push({ from: `SRS-${pad(s)}`, rel: 'implements', to: ref });
  });
  DES.forEach(([t, srs], i) => {
    const ref = `DES-${pad(i + 1)}`;
    items.push({ ref, kind: 'DES', title: t, body: `Detailed design of the ${t.toLowerCase()}.`, safetyClass: 'C' });
    // Deliberate gap: SRS-030 has no detailed design.
    for (const s of srs) if (s !== 30) links.push({ from: ref, rel: 'designs', to: `SRS-${pad(s)}` });
  });

  // 35 implementation stories: one per SRS (30) + 5 extra on the busiest areas.
  for (let i = 1; i <= 30; i++) {
    const srs = SRS[i - 1][0];
    const des = DES.findIndex(([, list]) => list.includes(i));
    const area = des >= 0 ? DES[des][0].toLowerCase().replace(/ and /g, '-').replace(/\s+/g, '-') : 'core';
    items.push({
      ref: `IMP-${pad(i)}`,
      kind: 'IMP',
      title: `Implement: ${srs.replace(/ shall /, ' ')}`,
      body: `Implements SRS-${pad(i)}.`,
      paths: [`src/${area}/`],
    });
    links.push({ from: `IMP-${pad(i)}`, rel: 'implements', to: `SRS-${pad(i)}` });
  }
  const extras: [string, number][] = [
    ['Refactor motor step timing', 1],
    ['Alarm tone selection', 7],
    ['Event log export to USB', 16],
    ['Drug library update flow', 13],
    ['Self-test error codes table', 24],
  ];
  extras.forEach(([t, s], i) => {
    const ref = `IMP-${pad(31 + i)}`;
    items.push({ ref, kind: 'IMP', title: t, body: `Supports SRS-${pad(s)}.`, paths: ['src/'] });
    links.push({ from: ref, rel: 'implements', to: `SRS-${pad(s)}` });
  });

  // 40 tests: one per SRS except SRS-027 (deliberate gap) = 29, plus 9 RC tests (not RC-010) + 2 unit tests.
  let v = 0;
  const ver = (title: string, target: string, result: VerificationResult = 'pass') => {
    const ref = `VER-${pad(++v)}`;
    items.push({ ref, kind: 'VER', title, body: `Verifies ${target}.`, result });
    links.push({ from: ref, rel: 'verifies', to: target });
  };
  for (let i = 1; i <= 30; i++) {
    if (i === 27) continue;
    ver(`Test: ${SRS[i - 1][0].replace(/ shall /, ' ')}`, `SRS-${pad(i)}`, i === 21 ? 'fail' : 'pass');
  }
  for (let i = 1; i <= 9; i++) ver(`Risk control test: ${RC[i - 1][0]}`, `RC-${pad(i)}`);
  // Two unit-test suites give unit verification for all 12 design items.
  ver('Unit test suite: control layer (motor, occlusion, air)', 'DES-001');
  ver('Unit test suite: supervisory layer (alarms, power, UI)', 'DES-004');
  for (const [d, suite] of [
    ['DES-002', 'VER-039'], ['DES-003', 'VER-039'], ['DES-005', 'VER-040'], ['DES-006', 'VER-040'],
    ['DES-007', 'VER-040'], ['DES-008', 'VER-040'], ['DES-009', 'VER-040'], ['DES-010', 'VER-039'],
    ['DES-011', 'VER-040'], ['DES-012', 'VER-039'],
  ] as const) {
    links.push({ from: suite, rel: 'verifies', to: d });
  }

  return { items, links, suspectTarget: 'SRS-004' };
}

/**
 * The sample project as an in-memory graph (all links verified against
 * version 1, then the suspect target edited to version 2). Used by tests and
 * as the reference for what the seeder must produce on a site.
 */
export function sampleGraphData(now = '2026-12-12T09:00:00.000Z'): { artifacts: Artifact[]; edges: Edge[] } {
  const p = buildSampleProject();
  const artifacts: Artifact[] = p.items.map((it) => ({
    id: `sample:${it.ref}`,
    kind: it.kind,
    source: 'import',
    sourceId: it.ref,
    key: it.ref,
    title: it.title,
    safetyClass: it.safetyClass,
    version: it.ref === p.suspectTarget ? 2 : 1,
    updatedAt: now,
    result: it.result,
    releases: [SAMPLE_RELEASE],
    paths: it.paths,
    sample: true,
  }));
  const edges: Edge[] = p.links.map((l) => ({
    id: edgeId(`sample:${l.from}`, l.rel, `sample:${l.to}`),
    fromId: `sample:${l.from}`,
    toId: `sample:${l.to}`,
    rel: l.rel,
    createdAt: now,
    verifiedAgainstVersion: 1,
  }));
  return { artifacts, edges };
}
