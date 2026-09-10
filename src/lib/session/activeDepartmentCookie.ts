/**
 * Name of the display-only "which department is currently active" cookie
 * set by POST /api/session/active-department. Shared between that route and
 * dashboard/page.tsx (which reads it to narrow the version list) so the two
 * can never drift on the cookie name. See that route's own doc comment for
 * why this cookie is never itself a source of authorization.
 */
export const ACTIVE_DEPARTMENT_COOKIE = "ebs_active_department";
