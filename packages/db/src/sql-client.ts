/** Minimal client shape, satisfied by pg and @neondatabase/serverless clients and pools. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}
