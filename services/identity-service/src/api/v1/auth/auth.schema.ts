import { loginSchema, switchOrgSchema, createChangePasswordSchema } from '@crm/validation';
import { config } from '../../../config/index.js';

export { loginSchema, switchOrgSchema };
export const changePasswordSchema = createChangePasswordSchema(config.passwordMinLength);

export type { LoginInput, SwitchOrgInput, ChangePasswordInput } from '@crm/validation';
