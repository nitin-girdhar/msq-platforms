import { config } from '../../../config/index.js';

// Plain-text + matching HTML bodies for the three Team-management notifications.
// Pure string builders — no I/O, no PII logging. The send itself is
// lib/communication-service-client.ts; the authorization is users.controller.
//
// {{app_name}} and the sign-in URL come from config (APP_NAME / AUTH_WEB_URL).

interface BuiltEmail {
  subject: string;
  body: string;
  html: string;
}

const APP = config.appName;
const LOGIN_URL = config.authWebUrl;

// Minimal HTML escape for the few interpolated values (names, emails, branch
// labels). The subject is never HTML and communication-service already rejects
// header control characters.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(lines: string[]): string {
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#0F172A;line-height:1.6">${lines
    .map((l) => `<p style="margin:0 0 12px">${l}</p>`)
    .join('')}</div>`;
}

function greeting(firstName: string | null | undefined): string {
  const name = (firstName ?? '').trim();
  return name ? `Hi ${name},` : 'Hi,';
}

export interface AccountCreatedParams {
  firstName?: string | null;
  email: string;
  tempPassword: string;
  forcePasswordChange: boolean;
}

export function buildAccountCreatedEmail(p: AccountCreatedParams): BuiltEmail {
  const forceLine = p.forcePasswordChange
    ? "You'll be asked to set your own password the first time you sign in."
    : '';
  const bodyLines = [
    greeting(p.firstName),
    `An account has been created for you on ${APP}.`,
    `Sign in:            ${LOGIN_URL}`,
    `Username (email):   ${p.email}`,
    `Temporary password: ${p.tempPassword}`,
    ...(forceLine ? [forceLine] : []),
    "If you weren't expecting this, please contact your administrator.",
    `— ${APP}`,
  ];
  const htmlLines = [
    esc(greeting(p.firstName)),
    `An account has been created for you on ${esc(APP)}.`,
    `<strong>Sign in:</strong> <a href="${esc(LOGIN_URL)}">${esc(LOGIN_URL)}</a>`,
    `<strong>Username (email):</strong> ${esc(p.email)}`,
    `<strong>Temporary password:</strong> <code>${esc(p.tempPassword)}</code>`,
    ...(forceLine ? [esc(forceLine)] : []),
    "If you weren't expecting this, please contact your administrator.",
    `— ${esc(APP)}`,
  ];
  return {
    subject: `Your ${APP} account is ready`,
    body: bodyLines.join('\n\n'),
    html: wrapHtml(htmlLines),
  };
}

export interface PasswordResetParams {
  firstName?: string | null;
  // null when the admin set a specific password — the value is never emailed.
  tempPassword: string | null;
}

export function buildPasswordResetEmail(p: PasswordResetParams): BuiltEmail {
  const bodyLines = p.tempPassword
    ? [
        greeting(p.firstName),
        `An administrator reset your ${APP} password.`,
        `Sign in:            ${LOGIN_URL}`,
        `Temporary password: ${p.tempPassword}`,
        "You'll be asked to choose a new password when you sign in.",
        "If you didn't expect this, contact your administrator immediately.",
        `— ${APP}`,
      ]
    : [
        greeting(p.firstName),
        `An administrator changed your ${APP} password. If you don't already know the new password, please ask them directly.`,
        `Sign in: ${LOGIN_URL}`,
        "If you didn't expect this, contact your administrator immediately.",
        `— ${APP}`,
      ];
  const htmlLines = p.tempPassword
    ? [
        esc(greeting(p.firstName)),
        `An administrator reset your ${esc(APP)} password.`,
        `<strong>Sign in:</strong> <a href="${esc(LOGIN_URL)}">${esc(LOGIN_URL)}</a>`,
        `<strong>Temporary password:</strong> <code>${esc(p.tempPassword)}</code>`,
        "You'll be asked to choose a new password when you sign in.",
        "If you didn't expect this, contact your administrator immediately.",
        `— ${esc(APP)}`,
      ]
    : [
        esc(greeting(p.firstName)),
        `An administrator changed your ${esc(APP)} password. If you don't already know the new password, please ask them directly.`,
        `<strong>Sign in:</strong> <a href="${esc(LOGIN_URL)}">${esc(LOGIN_URL)}</a>`,
        "If you didn't expect this, contact your administrator immediately.",
        `— ${esc(APP)}`,
      ];
  return {
    subject: `Your ${APP} password was reset`,
    body: bodyLines.join('\n\n'),
    html: wrapHtml(htmlLines),
  };
}

export interface BranchChangedParams {
  firstName?: string | null;
  added: string[];
  removed: string[];
  // Set only when the home branch itself moved.
  newHomeBranch?: string | null;
}

export function buildBranchChangedEmail(p: BranchChangedParams): BuiltEmail {
  const detail: string[] = [];
  if (p.added.length) detail.push(`Added branches:   ${p.added.join(', ')}`);
  if (p.removed.length) detail.push(`Removed branches: ${p.removed.join(', ')}`);
  if (p.newHomeBranch) detail.push(`Home branch:      ${p.newHomeBranch}`);
  // Fallback so the email is never empty of specifics when only ids were known.
  if (detail.length === 0) detail.push('Your branch memberships were updated.');

  const bodyLines = [
    greeting(p.firstName),
    `An administrator updated your branch access on ${APP}.`,
    detail.join('\n'),
    `Sign in: ${LOGIN_URL}`,
    'If this looks wrong, contact your administrator.',
    `— ${APP}`,
  ];
  const htmlLines = [
    esc(greeting(p.firstName)),
    `An administrator updated your branch access on ${esc(APP)}.`,
    detail.map(esc).join('<br>'),
    `<strong>Sign in:</strong> <a href="${esc(LOGIN_URL)}">${esc(LOGIN_URL)}</a>`,
    'If this looks wrong, contact your administrator.',
    `— ${esc(APP)}`,
  ];
  return {
    subject: `Your ${APP} branch access has changed`,
    body: bodyLines.join('\n\n'),
    html: wrapHtml(htmlLines),
  };
}
