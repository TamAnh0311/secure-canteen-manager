import { validateEnv } from './env-validation';

export default (): ReturnType<typeof validateEnv> => {
  return validateEnv(process.env as Record<string, unknown>);
};
