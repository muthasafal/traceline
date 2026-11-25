import { StandardPack } from './types';
import { hasDownstream, tracesUpTo, verified } from './rules';

const ALL = ['A', 'B', 'C'] as const;
const B = ['B'] as const;
const C = ['C'] as const;

/**
 * IEC 62304 (medical device software life cycle) with ISO 14971 risk links.
 * Clause numbers follow IEC 62304:2006+A1:2015. Which classes a rule applies
 * at is Traceline's default and can be tightened in settings.
 */
export const IEC62304: StandardPack = {
  id: 'iec62304',
  name: 'IEC 62304 + ISO 14971',
  basis: 'Clause structure of IEC 62304:2006+A1:2015; risk links per ISO 14971.',
  levelName: 'Software safety class',
  levels: ['A', 'B', 'C'],
  defaultLevel: 'C',
  depth: 'full',
  changeClause: '7.4',
  clauses: [
    { id: '5.2', title: 'Software requirements analysis' },
    { id: '5.3', title: 'Software architectural design' },
    { id: '5.4', title: 'Software detailed design' },
    { id: '5.5', title: 'Software unit implementation and verification' },
    { id: '5.7', title: 'Software system testing' },
    { id: '7.2', title: 'Risk control measures' },
    { id: '7.3', title: 'Verification of risk control measures' },
    { id: '7.4', title: 'Risk management of software changes' },
  ],
  rules: [
    tracesUpTo(
      { id: 'iec62304.srs-traces-sys', clause: '5.2', requiredFor: ALL, blocking: true },
      'SRS',
      'derives',
      'SYS',
    ),
    verified({ id: 'iec62304.srs-verified', clause: '5.7', requiredFor: ALL, blocking: true }, 'SRS', 'test'),
    hasDownstream(
      { id: 'iec62304.srs-implemented', clause: '5.5', requiredFor: ALL, blocking: true },
      'SRS',
      'implements',
      'IMP',
      'is implemented by',
    ),
    hasDownstream(
      { id: 'iec62304.srs-designed', clause: '5.3', requiredFor: B, blocking: false },
      'SRS',
      'designs',
      'DES',
      'is allocated to',
    ),
    hasDownstream(
      { id: 'iec62304.c-srs-detailed-design', clause: '5.4', requiredFor: C, blocking: true },
      'SRS',
      'designs',
      'DES',
      'has detailed design in',
    ),
    verified(
      { id: 'iec62304.c-unit-verified', clause: '5.5', requiredFor: C, blocking: true },
      'DES',
      'unit verification',
    ),
    hasDownstream(
      { id: 'iec62304.haz-controlled', clause: '7.2', requiredFor: ALL, blocking: true },
      'HAZ',
      'mitigates',
      'RC',
      'is mitigated by',
    ),
    hasDownstream(
      { id: 'iec62304.rc-in-srs', clause: '7.2', requiredFor: ALL, blocking: true },
      'RC',
      'implements',
      'SRS',
      'is implemented by',
    ),
    verified({ id: 'iec62304.rc-verified', clause: '7.3', requiredFor: ALL, blocking: true }, 'RC'),
  ],
};
