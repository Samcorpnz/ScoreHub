import { redirect } from "next/navigation";

// The control panel lives at /control/<matchId>. This keeps older links and
// bookmarks (/control?matchId=…) working, and sends a bare /control — which
// names no match — to the dashboard to pick or set one up.
export default async function ControlRedirect({
  searchParams,
}: {
  readonly searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { matchId } = await searchParams;
  if (typeof matchId === "string" && matchId) redirect(`/control/${encodeURIComponent(matchId)}`);
  redirect("/dashboard");
}
