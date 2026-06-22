import { testEnvironment as openclawGatewayTestEnvironment } from "@paperclipai/adapter-openclaw-gateway/server";
import { type } from "../index.js";

/**
 * denchclaw_crm.testEnvironment — delegates transport connectivity checks to
 * openclaw_gateway, then re-stamps the result under this adapter's type so the
 * UI attributes the checks correctly.
 */
export const testEnvironment: typeof openclawGatewayTestEnvironment = async (ctx) => {
  const result = await openclawGatewayTestEnvironment(ctx);
  return { ...result, adapterType: type };
};
