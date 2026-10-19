import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_trading_rules",
  title: "List trading rules",
  description: "List the signed-in user's trading rules (checklist derived from the error catalog).",
  inputSchema: {
    only_active: z.boolean().default(true).describe("Only return rules where is_active = true."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ only_active }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = supabaseForUser(ctx)
      .from("trading_rules")
      .select("*")
      .eq("user_id", ctx.getUserId())
      .order("created_at", { ascending: false });
    if (only_active) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { rules: data ?? [] },
    };
  },
});
