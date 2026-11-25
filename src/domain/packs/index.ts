import { DO178C } from './do178c';
import { IEC62304 } from './iec62304';
import { ISO26262 } from './iso26262';
import { StandardPack } from './types';

export * from './types';
export { IEC62304, ISO26262, DO178C };

export const PACKS: Record<StandardPack['id'], StandardPack> = {
  iec62304: IEC62304,
  iso26262: ISO26262,
  do178c: DO178C,
};

export function getPack(id: string | undefined): StandardPack {
  return PACKS[(id ?? 'iec62304') as StandardPack['id']] ?? IEC62304;
}
