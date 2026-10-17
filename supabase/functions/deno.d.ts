// The Deno APIs the edge functions use, for `tsc -p tsconfig.functions.json` (the functions run on Supabase's Deno).
declare namespace Deno {
  export const env: { get(key: string): string | undefined };
  export function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
