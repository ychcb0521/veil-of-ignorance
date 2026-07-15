import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_recent_journals",
  title: "List recent trade journals",
  description:
    "List the signed-in user's most recent trade journal entries (错题集), newest first. Returns id, symbol, direction, outcome, entry reason, and simulated time.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(10).describe("Max journals to return (1-50)."),
    symbol: z.string().trim().optional().describe("Optional symbol filter, e.g. BTCUSDT."),
    outcome: z.enum(["win", "loss", "breakeven", "no_entry"]).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, symbol, outcome }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = sb(ctx)
      .from("trade_journals")
      .select("id, symbol, direction, post_outcome, pre_entry_reason, pre_simulated_time, post_review_summary")
      .eq("user_id", ctx.getUserId())
      .order("pre_simulated_time", { ascending: false })
      .limit(limit);
    if (symbol) q = q.eq("symbol", symbol);
    if (outcome) q = q.eq("post_outcome", outcome);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { journals: data ?? [] },
    };
  },
});
