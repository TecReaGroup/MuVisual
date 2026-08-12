import { loadEnvFile } from 'node:process';

if (process.env.NODE_ENV !== 'production') {
  try {
    loadEnvFile();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export const environment = {
  authPassword: process.env.AUTH_PASSWORD,
  isProduction: process.env.NODE_ENV === 'production',
  modalKey: process.env.MODAL_KEY,
  modalSecret: process.env.MODAL_SECRET,
  modalUrl: process.env.MODAL_URL,
  port: Number(process.env.PORT || 8787),
};

export function validateEnvironment() {
  const missingVariables = [];
  if (!environment.authPassword) missingVariables.push('AUTH_PASSWORD');
  return missingVariables;
}
