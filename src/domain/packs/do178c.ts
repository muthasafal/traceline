import { StandardPack } from './types';
import { hasDownstream, tracesUpTo, verified } from './rules';

const AD = ['A', 'B', 'C', 'D'] as const;
const AC = ['A', 'B', 'C'] as const;

/**
 * DO-178C (airborne software), light pack. SRS maps to high-level
 * requirements, DES to low-level requirements / design. Levels run A (most
 * stringent) to E (no objectives), stored least to most stringent.
 */
export const DO178C: StandardPack = {
  id: 'do178c',
  name: 'DO-178C (light)',
  basis: 'Section structure of RTCA DO-178C.',
  levelName: 'Software level (DAL)',
  levels: ['E', 'D', 'C', 'B', 'A'],
  defaultLevel: 'A',
  depth: 'light',
  changeClause: '7.2',
  clauses: [
    { id: '5.1', title: 'Software requirements process' },
    { id: '5.2', title: 'Software design process' },
    { id: '5.5', title: 'Software development process traceability' },
    { id: '6.4', title: 'Software testing' },
    { id: '7.2', title: 'Software configuration management activities' },
  ],
  rules: [
    tracesUpTo({ id: 'do178c.hlr-traces-sys', clause: '5.5', requiredFor: AD, blocking: true }, 'SRS', 'derives', 'SYS'),
    verified({ id: 'do178c.hlr-tested', clause: '6.4', requiredFor: AD, blocking: true }, 'SRS', 'requirements-based test'),
    hasDownstream({ id: 'do178c.hlr-has-llr', clause: '5.2', requiredFor: AC, blocking: true }, 'SRS', 'designs', 'DES', 'is refined into'),
    hasDownstream({ id: 'do178c.hlr-implemented', clause: '5.5', requiredFor: AD, blocking: false }, 'SRS', 'implements', 'IMP', 'is implemented by'),
    verified({ id: 'do178c.llr-tested', clause: '6.4', requiredFor: AC, blocking: true }, 'DES', 'requirements-based test'),
  ],
};
