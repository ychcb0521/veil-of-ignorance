# Agent integrations
- [x] Repair authenticated MCP runtime configuration and validate the five-tool catalog.
- [x] Preserve authorization through signup and verify consent failure/retry boundaries.
- [x] Add read-only and tab-selection browser tools to the journal page using the WebMCP tools skill.
- [x] Run 31 targeted tests; verify signed-in journal tabs and invalid consent handling with no fresh runtime errors.
- [ ] Full-project release validation: blocked by pre-existing trading/test TypeScript errors outside the integration changes; external OAuth approve/deny round-trip awaits a real client connection after republishing.
- [ ] Republish the app: requires the user's publishing action after resolving release checks.