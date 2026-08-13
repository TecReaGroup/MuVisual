import { fileURLToPath } from 'node:url';

export const paths = {
  distRoot: fileURLToPath(new URL('../../../dist/', import.meta.url)),
  logFile: fileURLToPath(new URL('../../data/log/backend.log', import.meta.url)),
  logRoot: fileURLToPath(new URL('../../data/log/', import.meta.url)),
  modalRoot: fileURLToPath(new URL('../../data/modal/', import.meta.url)),
  visualRoot: fileURLToPath(new URL('../../data/visual/', import.meta.url)),
};
