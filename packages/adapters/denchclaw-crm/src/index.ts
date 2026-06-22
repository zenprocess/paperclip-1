export const type = "denchclaw_crm";
export const label = "DenchClaw CRM";

export const models: { id: string; label: string }[] = [];

export const agentConfigurationDoc = `# denchclaw_crm agent configuration

Adapter: denchclaw_crm

A thin transport adapter that wraps \`openclaw_gateway\` with CRM-specific defaults.
It dispatches agent WORK to the DenchClaw agent (LLM reasoning + CRM enrichment).
It performs NO CRM CRUD itself — the DenchClaw agent reads/writes CRM data via the
DenchClaw REST API. Deterministic CRM data projection (DenchClaw entries -> Paperclip
cards) is handled by the in-process CRM sync, not by this adapter.

Use when:
- A Paperclip board projects DenchClaw CRM objects as cards and a lane move should
  dispatch agent work (research a contact, draft outreach, summarize an interaction).

Core fields (passed through to openclaw_gateway):
- url (string, required): DenchClaw OpenClaw gateway WebSocket URL (ws:// or wss://)
- authToken / password (string, optional): gateway auth
- sessionKeyStrategy (string, optional): defaults to "issue" (one session per card)
- payloadTemplate (object, optional): extra fields merged into the gateway request

See the openclaw_gateway adapter docs for the full transport field reference.
`;
