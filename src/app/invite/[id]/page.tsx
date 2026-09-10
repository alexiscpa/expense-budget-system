import { InviteAcceptForm } from "./InviteAcceptForm";

// Public route (not under /dashboard, so middleware.ts never redirects it
// to /login) - identity here is proven by the token typed into the form,
// not by any existing session. Content depends on request-time invitation
// status (see InviteAcceptForm's own GET call), so never statically generated.
export const dynamic = "force-dynamic";

export default function InvitePage({ params }: { params: { id: string } }) {
  return <InviteAcceptForm invitationId={params.id} />;
}
