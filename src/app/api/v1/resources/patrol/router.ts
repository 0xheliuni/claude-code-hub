import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  PatrolBaselineSchema,
  PatrolConfigSchema,
  PatrolProbeInfoSchema,
  PatrolResultSchema,
  PatrolStatusSchema,
  PatrolTriggerRequestSchema,
} from "@/lib/api/v1/schemas/patrol";
import {
  deleteBaseline,
  deleteProviderConfig,
  getGlobalConfig,
  getPatrolResults,
  getPatrolStatus,
  getProviderConfig,
  listBaselines,
  listProbes,
  recoverProvider,
  triggerPatrol,
  updateGlobalConfig,
  updateProviderConfig,
} from "./handlers";

export const patrolRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return fromZodError(result.error, new URL(c.req.url).pathname);
  },
});

const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const problemResponses = {
  400: {
    description: "Invalid request.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "Authentication required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "Admin access required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "Not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

// GET /patrol/status
patrolRouter.openapi(
  createRoute({
    method: "get",
    path: "/patrol/status",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Get patrol system status",
    description: "Returns the current patrol configuration state and recent inspection results.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Patrol status.",
        content: { "application/json": { schema: PatrolStatusSchema } },
      },
      ...problemResponses,
    },
  }),
  getPatrolStatus as never
);

// GET /patrol/results
patrolRouter.openapi(
  createRoute({
    method: "get",
    path: "/patrol/results",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "List inspection results",
    description: "Returns paginated patrol inspection results with optional filters.",
    "x-required-access": "admin",
    security,
    request: {
      query: z.object({
        providerId: z.string().optional(),
        verdict: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Paginated inspection results.",
        content: {
          "application/json": {
            schema: z.object({
              results: z.array(PatrolResultSchema),
              total: z.number().int(),
              limit: z.number().int(),
              offset: z.number().int(),
            }),
          },
        },
      },
      ...problemResponses,
    },
  }),
  getPatrolResults as never
);

// POST /patrol/trigger
patrolRouter.openapi(
  createRoute({
    method: "post",
    path: "/patrol/trigger",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Trigger manual patrol run",
    description:
      "Triggers an immediate patrol inspection. Optionally specify a provider and inspection type.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        content: { "application/json": { schema: PatrolTriggerRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Patrol triggered.",
        content: {
          "application/json": { schema: z.object({ triggered: z.boolean() }) },
        },
      },
      ...problemResponses,
    },
  }),
  triggerPatrol as never
);

// GET /patrol/config/global
patrolRouter.openapi(
  createRoute({
    method: "get",
    path: "/patrol/config/global",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Get global patrol config",
    description: "Returns the effective global patrol configuration (merged defaults + overrides).",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Global patrol config.",
        content: { "application/json": { schema: PatrolConfigSchema } },
      },
      ...problemResponses,
    },
  }),
  getGlobalConfig as never
);

// PUT /patrol/config/global
patrolRouter.openapi(
  createRoute({
    method: "put",
    path: "/patrol/config/global",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Update global patrol config",
    description: "Updates the global patrol configuration. Only provided fields are updated.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        content: { "application/json": { schema: PatrolConfigSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated global config.",
        content: { "application/json": { schema: PatrolConfigSchema } },
      },
      ...problemResponses,
    },
  }),
  updateGlobalConfig as never
);

// GET /patrol/config/provider/:providerId
patrolRouter.openapi(
  createRoute({
    method: "get",
    path: "/patrol/config/provider/{providerId}",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Get provider patrol config overrides",
    description:
      "Returns the raw provider-specific patrol config overrides (only the fields this provider overrides; empty object if none).",
    "x-required-access": "admin",
    security,
    request: {
      params: z.object({ providerId: z.string() }),
    },
    responses: {
      200: {
        description: "Provider config overrides.",
        content: { "application/json": { schema: PatrolConfigSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderConfig as never
);

// PUT /patrol/config/provider/:providerId
patrolRouter.openapi(
  createRoute({
    method: "put",
    path: "/patrol/config/provider/{providerId}",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Update provider patrol config",
    description: "Sets provider-specific patrol configuration overrides.",
    "x-required-access": "admin",
    security,
    request: {
      params: z.object({ providerId: z.string() }),
      body: {
        content: { "application/json": { schema: PatrolConfigSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated provider config.",
        content: { "application/json": { schema: PatrolConfigSchema } },
      },
      ...problemResponses,
    },
  }),
  updateProviderConfig as never
);

// DELETE /patrol/config/provider/:providerId
patrolRouter.openapi(
  createRoute({
    method: "delete",
    path: "/patrol/config/provider/{providerId}",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Delete provider patrol config",
    description: "Removes provider-specific config overrides, reverting to global defaults.",
    "x-required-access": "admin",
    security,
    request: {
      params: z.object({ providerId: z.string() }),
    },
    responses: {
      200: {
        description: "Config deleted.",
        content: {
          "application/json": { schema: z.object({ deleted: z.boolean() }) },
        },
      },
      ...problemResponses,
    },
  }),
  deleteProviderConfig as never
);

// GET /patrol/baselines
patrolRouter.openapi(
  createRoute({
    method: "get",
    path: "/patrol/baselines",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "List fingerprint baselines",
    description: "Returns all stored fingerprint baselines used for statistical matching.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Baseline list.",
        content: { "application/json": { schema: z.array(PatrolBaselineSchema) } },
      },
      ...problemResponses,
    },
  }),
  listBaselines as never
);

// DELETE /patrol/baselines/:id
patrolRouter.openapi(
  createRoute({
    method: "delete",
    path: "/patrol/baselines/{id}",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Delete a fingerprint baseline",
    description: "Removes a fingerprint baseline by ID.",
    "x-required-access": "admin",
    security,
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: "Baseline deleted.",
        content: {
          "application/json": { schema: z.object({ deleted: z.boolean() }) },
        },
      },
      ...problemResponses,
    },
  }),
  deleteBaseline as never
);

// POST /patrol/recover/:providerId
patrolRouter.openapi(
  createRoute({
    method: "post",
    path: "/patrol/recover/{providerId}",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "Manually recover a provider",
    description: "Re-enables a provider that was disabled by patrol and resets its patrol state.",
    "x-required-access": "admin",
    security,
    request: {
      params: z.object({ providerId: z.string() }),
    },
    responses: {
      200: {
        description: "Provider recovered.",
        content: {
          "application/json": {
            schema: z.object({ recovered: z.boolean(), providerId: z.number().int() }),
          },
        },
      },
      ...problemResponses,
    },
  }),
  recoverProvider as never
);

// GET /patrol/probes
patrolRouter.openapi(
  createRoute({
    method: "get",
    path: "/patrol/probes",
    middleware: requireAuth("admin"),
    tags: ["Patrol"],
    summary: "List available probes",
    description: "Returns metadata about all registered detection probes.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Probe list.",
        content: { "application/json": { schema: z.array(PatrolProbeInfoSchema) } },
      },
      ...problemResponses,
    },
  }),
  listProbes as never
);
