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
  name: "list_error_patterns",
  title: "List error tag patterns",
  description:
    "List the signed-in user's error tag patterns (个人错题标签), sorted by occurrence count. Useful for seeing which mistake patterns recur most.",
  inputSchema: {
    include_archived: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(30),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ include_archived, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = sb(ctx)
      .from("error_tag_patterns")
      .select("id, category_id, pattern_name, operational_definition, occurrence_count, last_seen_at, is_archived")
      .eq("user_id", ctx.getUserId())
      .order("occurrence_count", { ascending: false })
      .limit(limit);
    if (!include_archived) q = q.eq("is_archived", false);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { patterns: data ?? [] },
    };
  },
});
