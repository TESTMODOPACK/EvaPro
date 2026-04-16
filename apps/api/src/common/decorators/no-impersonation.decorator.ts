import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by `NoImpersonationGuard`. Attach the decorator to
 * handlers that must be forbidden when the caller's JWT is an impersonation
 * token (i.e. `req.user.impersonatedBy` is set).
 *
 * Use for: password changes, 2FA setup/disable, GDPR personal export/delete,
 * updating the password policy or SSO config of the tenant, and all
 * platform-level endpoints (plans, billing, audit cross-tenant).
 */
export const NO_IMPERSONATION_KEY = 'noImpersonation';
export const NoImpersonation = () => SetMetadata(NO_IMPERSONATION_KEY, true);
