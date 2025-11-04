// Temporary stub route to isolate build issue. Returns empty holiday list without imports.
export async function GET() {
  const body = JSON.stringify({ holidays: [], error: "temporarily disabled" });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}
