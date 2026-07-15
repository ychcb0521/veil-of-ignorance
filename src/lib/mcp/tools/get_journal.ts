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
  name: "get_journal",
  title: "Get trade journal by id",
  description: "Fetch one full trade journal row (pre-trade snapshot + post-trade review) for the signed-in user.",
  inputSchema: {
    journal_id: z.string().uuid().describe("Trade journal UUID."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ journal_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await sb(ctx)
      .from("trade_journals")
      .select("*")
      .eq("id", journal_id)
      .eq("user_id", ctx.getUserId())
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Journal not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { journal: data },
    };
  },
});
