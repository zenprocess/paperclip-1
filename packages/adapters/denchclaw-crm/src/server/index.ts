// execute + enrichCrmConfig
export { execute, enrichCrmConfig } from "./execute.js";

// testEnvironment
export { testEnvironment } from "./test.js";

// bus-bridge handler factory + public types
export { createCrmStatusHandler } from "./bus-bridge.js";
export type { CrmIssueEvent, CrmBridgePorts } from "./bus-bridge.js";

// DenchClaw REST client
export { DenchClawClient, DenchClawApiError } from "./denchclaw-client.js";
export type { DenchClawClientOptions } from "./denchclaw-client.js";

// config loader
export { loadCrmConfig, resolveTenantEndpoint } from "./config.js";
export type { CrmConfig, CrmTenant } from "./config.js";

// card mappers + helpers
export {
  personToCard,
  personCompanyRef,
  companyToCard,
  statusFromStrengthScore,
  priorityFromStrengthScore,
  CRM_PEOPLE_PROJECT_KEY,
  CRM_COMPANIES_PROJECT_KEY,
} from "./card-schema.js";
export type { CrmCardInput } from "./card-schema.js";

// billing-code helpers
export {
  formatBillingCode,
  parseBillingCode,
  isCrmBillingCode,
} from "./billing-code.js";
export type { CrmObject, ParsedBillingCode } from "./billing-code.js";

// sync planner
export { computeSyncPlan, cardChecksum } from "./sync-plan.js";
export type { SyncPlan, SyncAction, ExistingCard } from "./sync-plan.js";

// lane-action table + helpers
export { actionForStatus, LANE_ACTION_TABLE, ACTION_PROMPTS } from "./lane-actions.js";
export type { CrmLaneAction } from "./lane-actions.js";

// raw CRM record types
export type {
  DenchClawPerson,
  DenchClawCompany,
  DenchClawPeopleListResponse,
} from "./types.js";
