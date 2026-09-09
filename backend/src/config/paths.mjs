import { fileURLToPath } from 'node:url';

export const paths = {
  distRoot: fileURLToPath(new URL('../../../dist/', import.meta.url)),
  logRoot: fileURLToPath(new URL('../../data/log/', import.meta.url)),
  uploadRoot: fileURLToPath(new URL('../../data/upload/', import.meta.url)),
  presetRoot: fileURLToPath(new URL('../../data/preset/', import.meta.url)),
};
