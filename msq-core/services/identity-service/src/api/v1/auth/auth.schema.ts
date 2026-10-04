import { loginSchema, switchOrgSchema, createChangePasswordSchema, forgotPasswordSchema, createSelfResetPasswordSchema } from '@platform/validation';
import { config } from '../../../config/index.js';

export { loginSchema, switchOrgSchema, forgotPasswordSchema };
export const changePasswordSchema = createChangePasswordSchema(config.passwordMinLength);
export const resetPasswordSchema = createSelfResetPasswordSchema(config.passwordMinLength);

export type { LoginInput, SwitchOrgInput, ChangePasswordInput, ForgotPasswordInput, SelfResetPasswordInput } from '@platform/validation';
