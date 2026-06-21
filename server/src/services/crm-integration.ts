/**
 * CRM integration wiring — denchclaw-crm bus-bridge.
 *
 * Inert by default: if `DENCHCLAW_CRM_SYNC_ENABLED` is not set (or set to a
 * falsy value), this module returns immediately without subscribing to any
 * events or touching the DB.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";
import {
  loadCrmConfig,
  createCrmStatusHandler,
  resolveTenantEndpoint,
  DenchClawClient,
  personToCard,
  personCompanyRef,
  companyToCard,
  computeSyncPlan,
  cardChecksum,
  CRM_PEOPLE_PROJECT_KEY,
  CRM_COMPANIES_PROJECT_KEY,
  type CrmBridgePorts,
  type CrmConfig,
  type CrmCardInput,
  type CrmTenant,
} from "@paperclipai/adapter-denchclaw-crm/server";
import type { IssuePriority, IssueStatus } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { issueService } from "./issues.js";
import { projectService } from "./projects.js";
import { heartbeatService } from "./heartbeat.js";
import type { PluginEventBus } from "./plugin-event-bus.js";

// ---------------------------------------------------------------------------
// Module logger (thin wrapper matching CrmBridgePorts.logger shape)
// ---------------------------------------------------------------------------

const crmLogger: Required<NonNullable<CrmBridgePorts["logger"]>> = {
  info: (m) => logger.info({ component: "crm-integration" }, m),
  warn: (m) => logger.warn({ component: "crm-integration" }, m),
  error: (m) => logger.error({ component: "crm-integration" }, m),
};

// ---------------------------------------------------------------------------
// People sync
// ---------------------------------------------------------------------------

async function syncTenantPeople(db: Db, cfg: CrmConfig, tenant: CrmTenant): Promise<void> {
  const { baseUrl, serviceToken } = resolveTenantEndpoint(cfg, tenant);
  const client = new DenchClawClient({ baseUrl, serviceToken });

  const cards = (await client.listPeople()).map(personToCard);

  // Find-or-create the "crm-people" project for this tenant.
  const svc = projectService(db);
  const existingProjects = await svc.list(tenant.companyId);
  const crmProject =
    existingProjects.find((p) => p.name === CRM_PEOPLE_PROJECT_KEY) ??
    (await svc.create(tenant.companyId, { name: CRM_PEOPLE_PROJECT_KEY }));
  const projectId = crmProject.id;

  // Build an ExistingCard map keyed by billingCode, reconstructing the checksum
  // from current issue fields (no stored checksum column — compute on the fly).
  const existingIssues = await issueService(db).list(tenant.companyId, { projectId });
  const existingMap = new Map(
    existingIssues
      .filter((issue) => issue.billingCode != null)
      .map((issue) => {
        const syntheticCard: CrmCardInput = {
          title: issue.title ?? "",
          description: issue.description ?? "",
          priority: issue.priority as IssuePriority,
          billingCode: issue.billingCode as string,
          projectKey: CRM_PEOPLE_PROJECT_KEY,
          // status excluded from checksum — user owns the lane
          status: issue.status as IssueStatus,
        };
        return [
          issue.billingCode as string,
          {
            issueId: issue.id,
            billingCode: issue.billingCode as string,
            checksum: cardChecksum(syntheticCard),
          },
        ] as const;
      }),
  );

  const plan = computeSyncPlan(cards, existingMap);

  const isvc = issueService(db);

  for (const action of plan.creates) {
    await isvc.create(tenant.companyId, {
      title: action.card.title,
      description: action.card.description,
      status: action.card.status,
      priority: action.card.priority,
      billingCode: action.card.billingCode,
      projectId,
    });
  }

  for (const action of plan.updates) {
    await isvc.update(action.issueId, {
      title: action.card.title,
      description: action.card.description,
      priority: action.card.priority,
      // NEVER send status on update — user owns the lane
    });
  }

  logger.info(
    { component: "crm-integration", companyId: tenant.companyId },
    `CRM people sync: ${plan.creates.length} created, ${plan.updates.length} updated, ${plan.unchanged.length} unchanged`,
  );
}

// ---------------------------------------------------------------------------
// Companies sync
// ---------------------------------------------------------------------------

async function syncTenantCompanies(db: Db, cfg: CrmConfig, tenant: CrmTenant): Promise<void> {
  try {
    const { baseUrl, serviceToken } = resolveTenantEndpoint(cfg, tenant);
    const client = new DenchClawClient({ baseUrl, serviceToken });

    // Derive distinct company refs from the people list.
    const people = await client.listPeople();
    const companyRefs = new Set<string>(
      people.map(personCompanyRef).filter((ref): ref is string => ref !== undefined),
    );

    // Resolve each ref to a company record; skip nulls (404 → ref is a name not an id).
    const resolvedCompanies = await Promise.all(
      Array.from(companyRefs).map(async (ref) => {
        const company = await client.getCompany(ref);
        return company;
      }),
    );
    const cards = resolvedCompanies
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map(companyToCard);

    // Find-or-create the "crm-companies" project for this tenant.
    const svc = projectService(db);
    const existingProjects = await svc.list(tenant.companyId);
    const crmProject =
      existingProjects.find((p) => p.name === CRM_COMPANIES_PROJECT_KEY) ??
      (await svc.create(tenant.companyId, { name: CRM_COMPANIES_PROJECT_KEY }));
    const projectId = crmProject.id;

    // Build an ExistingCard map keyed by billingCode.
    const existingIssues = await issueService(db).list(tenant.companyId, { projectId });
    const existingMap = new Map(
      existingIssues
        .filter((issue) => issue.billingCode != null)
        .map((issue) => {
          const syntheticCard: CrmCardInput = {
            title: issue.title ?? "",
            description: issue.description ?? "",
            priority: issue.priority as IssuePriority,
            billingCode: issue.billingCode as string,
            projectKey: CRM_COMPANIES_PROJECT_KEY,
            // status excluded from checksum — user owns the lane
            status: issue.status as IssueStatus,
          };
          return [
            issue.billingCode as string,
            {
              issueId: issue.id,
              billingCode: issue.billingCode as string,
              checksum: cardChecksum(syntheticCard),
            },
          ] as const;
        }),
    );

    const plan = computeSyncPlan(cards, existingMap);

    const isvc = issueService(db);

    for (const action of plan.creates) {
      await isvc.create(tenant.companyId, {
        title: action.card.title,
        description: action.card.description,
        status: action.card.status,
        priority: action.card.priority,
        billingCode: action.card.billingCode,
        projectId,
      });
    }

    for (const action of plan.updates) {
      await isvc.update(action.issueId, {
        title: action.card.title,
        description: action.card.description,
        priority: action.card.priority,
        // NEVER send status on update — user owns the lane
      });
    }

    logger.info(
      { component: "crm-integration", companyId: tenant.companyId },
      `CRM companies sync: ${plan.creates.length} created, ${plan.updates.length} updated, ${plan.unchanged.length} unchanged`,
    );
  } catch (err: unknown) {
    logger.error(
      { component: "crm-integration", companyId: tenant.companyId, err },
      "CRM companies sync failed for tenant; will retry on next interval",
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry-point
// ---------------------------------------------------------------------------

/**
 * Wire the denchclaw-crm bus-bridge into the server.
 *
 * Reads config from the environment; if `syncEnabled` is false (the default),
 * logs one info line and returns immediately — no subscriptions, no side effects.
 */
export async function startCrmIntegration(deps: {
  db: Db;
  eventBus: PluginEventBus;
}): Promise<void> {
  const cfg = loadCrmConfig();

  if (!cfg.syncEnabled) {
    logger.info({ component: "crm-integration" }, "CRM sync disabled (DENCHCLAW_CRM_SYNC_ENABLED not set); skipping bus-bridge registration");
    return;
  }

  const ports: CrmBridgePorts = {
    // -----------------------------------------------------------------
    // getIssueBillingInfo — company-scoped lookup (tenant isolation)
    // -----------------------------------------------------------------
    async getIssueBillingInfo(
      companyId: string,
      issueId: string,
    ): Promise<{ billingCode: string | null } | null> {
      const rows = await deps.db
        .select({ billingCode: issues.billingCode })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));

      const row = rows[0] ?? null;
      if (!row) return null;
      return { billingCode: row.billingCode };
    },

    // -----------------------------------------------------------------
    // dispatchAgentWork — wakes the issue's assigned agent
    // -----------------------------------------------------------------
    async dispatchAgentWork({ companyId, issueId, action, prompt }): Promise<void> {
      const issue = await issueService(deps.db).getById(issueId);
      if (!issue) {
        crmLogger.warn(`crm-integration: issue ${issueId} not found; skipping agent dispatch`);
        return;
      }

      // Security: verify company ownership before dispatching
      if (issue.companyId !== companyId) {
        crmLogger.error(
          `crm-integration: companyId mismatch for issue ${issueId} (expected ${companyId}, got ${issue.companyId}); aborting dispatch`,
        );
        return;
      }

      const agentId = issue.assigneeAgentId;
      if (!agentId) {
        crmLogger.info(`crm-integration: no agent assigned to issue ${issueId}; skipping`);
        return;
      }

      await heartbeatService(deps.db).wakeup(agentId, {
        source: "automation",
        reason: prompt,
        triggerDetail: "system",
        contextSnapshot: { issueId, companyId, crmAction: action },
      });
    },

    logger: crmLogger,
  };

  // Obtain a scoped bus handle for the CRM integration (not a plugin, so we
  // use a stable internal key that cannot conflict with user-installed plugins).
  const scopedBus = deps.eventBus.forPlugin("paperclip.crm-integration");
  scopedBus.subscribe("issue.updated", createCrmStatusHandler(ports));

  logger.info({ component: "crm-integration" }, "CRM bus-bridge registered (subscribed to issue.updated)");

  // Periodic people-sync — one interval per tenant.
  for (const tenant of cfg.tenants) {
    const runSync = () => {
      syncTenantPeople(deps.db, cfg, tenant).catch((err: unknown) => {
        logger.error(
          { component: "crm-integration", companyId: tenant.companyId, err },
          "CRM people sync failed for tenant; will retry on next interval",
        );
      });
      syncTenantCompanies(deps.db, cfg, tenant);
    };
    // Initial sync on startup, then periodic.
    runSync();
    setInterval(runSync, cfg.syncIntervalMs);
  }
}
