import { StandardPack } from './types';
import { hasDownstream, tracesUpTo, verified } from './rules';

const ALL = ['QM', 'A', 'B', 'C', 'D'] as const;
const ASIL = ['A', 'B', 'C', 'D'] as const;
const CD = ['C', 'D'] as const;

/**
 * ISO 26262 (road vehicles, functional safety), light pack. Clause references
 * use the "part-clause" form, e.g. 6-9 is Part 6, clause 9.
 * HAZ maps to hazardous events / safety goals, RC to safety requirements.
 */
export const ISO26262: StandardPack = {
  id: 'iso26262',
  name: 'ISO 26262 (light)',
  basis: 'Clause structure of ISO 26262:2018 Parts 3, 6 and 8.',
  levelName: 'ASIL',
  levels: ['QM', 'A', 'B', 'C', 'D'],
  defaultLevel: 'D',
  depth: 'light',
  changeClause: '8-8',
  clauses: [
    { id: '3-6', title: 'Hazard analysis and risk assessment' },
    { id: '6-6', title: 'Specification of software safety requirements' },
    { id: '6-7', title: 'Software architectural design' },
    { id: '6-9', title: 'Software unit verification' },
    { id: '6-11', title: 'Testing of the embedded software' },
    { id: '8-6', title: 'Specification and management of safety requirements' },
    { id: '8-8', title: 'Change management' },
  ],
  rules: [
    tracesUpTo({ id: 'iso26262.srs-traces-sys', clause: '8-6', requiredFor: ASIL, blocking: true }, 'SRS', 'derives', 'SYS'),
    verified({ id: 'iso26262.srs-verified', clause: '6-11', requiredFor: ALL, blocking: true }, 'SRS', 'test'),
    hasDownstream({ id: 'iso26262.haz-goal', clause: '3-6', requiredFor: ASIL, blocking: true }, 'HAZ', 'mitigates', 'RC', 'is addressed by'),
    hasDownstream({ id: 'iso26262.srs-designed', clause: '6-7', requiredFor: CD, blocking: false }, 'SRS', 'designs', 'DES', 'is allocated to'),
    verified({ id: 'iso26262.unit-verified', clause: '6-9', requiredFor: CD, blocking: true }, 'DES', 'unit verification'),
  ],
};
