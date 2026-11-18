/**
 * Placeholder for the Sous browser Supabase client. This export has no
 * accounts, so it always returns null, and every caller already treats null
 * as "not signed in" (comment edit buttons hide, the author stamp is blank).
 *
 * When you add auth, return your real client here. The two calls the views
 * make are typed below: auth.getSession() and a single-row users lookup.
 */
export interface BrowserClient {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
  };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): { maybeSingle(): Promise<{ data: unknown }> };
    };
  };
}

export function createClient(): BrowserClient | null {
  return null;
}
