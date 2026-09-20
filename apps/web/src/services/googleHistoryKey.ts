/** Opaque association for user-authored time journals; exports contain no Google IDs. */
export async function googleHistoryKey(calendarId: string, eventId: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([calendarId, eventId])));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
