import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listRecentJournals from "./tools/list_recent_journals";
import getJournal from "./tools/get_journal";
import listTradingRules from "./tools/list_trading_rules";
import listErrorPatterns from "./tools/list_error_patterns";
import whoami from "./tools/whoami";

// Build the direct supabase.co issuer from the project ref (Vite inlines this
// at build time, keeping the module import-safe).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "trading-journal-mcp",
  title: "交易复盘中心 MCP",
  version: "0.1.0",
  instructions:
    "Tools for the trading journal / 错题集 app. Every tool acts as the signed-in user via Supabase RLS. Use `whoami` to confirm identity, `list_recent_journals` and `get_journal` to review trade journals, `list_error_patterns` to inspect recurring mistake patterns, and `list_trading_rules` to see the user's active checklist.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listRecentJournals, getJournal, listErrorPatterns, listTradingRules],
});
