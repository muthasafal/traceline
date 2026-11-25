import Resolver from '@forge/resolver';
import { matrix } from './reports';

const resolver = new Resolver();

resolver.define('getMatrix', async ({ payload, context }) => {
  const fromConfig = (context as { extension?: { config?: { release?: string } } }).extension?.config?.release;
  const release = (payload as { release?: string }).release ?? fromConfig;
  return matrix(release && release.trim() ? release.trim() : undefined);
});

export const matrixHandler = resolver.getDefinitions();
