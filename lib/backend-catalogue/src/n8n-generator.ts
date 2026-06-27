import type { BackendDefinition, ActionMapping } from "./n8n-backends";
import type { ContractAction } from "./backend-manifest";

/**
 * Pure n8n workflow generator. Turns a backend manifest into a complete,
 * importable workflow implementing the OmniProject gateway contract:
 *
 *   Webhook → Verify short-circuit → Loop guard → Route(action)
 *           → per-action HTTP node → Normalize → Respond
 *
 * Nothing here touches a backend or the network — it just builds JSON, so it's
 * fully unit-testable and keeps OmniProject stateless (the operator imports the
 * result into their own n8n).
 */

interface N8nNode {
  parameters: Record<string, unknown>;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  credentials?: Record<string, { id: string; name: string }>;
  notes?: string;
}

interface N8nWorkflow {
  name: string;
  meta: { templateId: string; description: string };
  active: boolean;
  settings: { executionOrder: string };
  pinData: Record<string, never>;
  nodes: N8nNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: "main"; index: number }>> }>;
}

// Deterministic UUID-shaped ids (n8n references nodes by name in connections,
// but ids must still be unique and well-formed).
function uid(i: number): string {
  const h = i.toString(16).padStart(12, "0");
  return `aaaaaaaa-0000-4000-8000-${h}`;
}

const ALWAYS: ContractAction = "get_capabilities";

function isWrite(m: ActionMapping): boolean {
  return m.method === "POST" || m.method === "PATCH" || m.method === "PUT" || m.method === "DELETE";
}

function credPlaceholder(manifest: BackendDefinition, credType: string): Record<string, { id: string; name: string }> {
  return { [credType]: { id: "", name: `${manifest.label} account` } };
}

function httpNode(id: string, name: string, mapping: ActionMapping, manifest: BackendDefinition, pos: [number, number]): N8nNode {
  // An n8n-managed credential (e.g. Microsoft Dynamics OAuth) takes over auth;
  // otherwise we forward the active user's bearer token.
  const credType = mapping.credentialType ?? manifest.credentialType;

  const headerParameters: Array<{ name: string; value: string }> = [];
  if (!credType && manifest.authHeader) {
    headerParameters.push({ name: "Authorization", value: manifest.authHeader });
  }
  if (isWrite(mapping)) {
    headerParameters.push({ name: "X-OmniProject-Idempotency-Key", value: "={{ $json.body.idempotencyKey }}" });
  }

  const parameters: Record<string, unknown> = {
    method: mapping.method,
    url: mapping.url,
    sendHeaders: headerParameters.length > 0,
    headerParameters: { parameters: headerParameters },
    options: {},
  };
  if (credType) {
    parameters["authentication"] = "predefinedCredentialType";
    parameters["nodeCredentialType"] = credType;
  }
  if (mapping.body) {
    parameters["sendBody"] = true;
    parameters["specifyBody"] = "json";
    parameters["jsonBody"] = mapping.body;
  }

  const node: N8nNode = { parameters, id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos };
  if (credType) node.credentials = credPlaceholder(manifest, credType);
  if (mapping.note) node.notes = mapping.note;
  return node;
}

function nativeNode(id: string, name: string, mapping: ActionMapping, manifest: BackendDefinition, pos: [number, number]): N8nNode {
  const credType = mapping.credentialType ?? manifest.credentialType;
  const node: N8nNode = {
    parameters: mapping.parameters ?? {},
    id,
    name,
    type: mapping.node!,
    typeVersion: mapping.typeVersion ?? 1,
    position: pos,
  };
  if (credType) node.credentials = credPlaceholder(manifest, credType);
  if (mapping.note) node.notes = mapping.note;
  return node;
}

function codeNode(id: string, name: string, jsCode: string, pos: [number, number]): N8nNode {
  return { parameters: { jsCode }, id, name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos };
}

export function generateWorkflow(manifest: BackendDefinition, opts: { webhookPath?: string } = {}): N8nWorkflow {
  const webhookPath = opts.webhookPath?.trim() || "omniproject";
  const actions = Object.keys(manifest.actions) as ContractAction[];
  if (!actions.includes(ALWAYS)) actions.push(ALWAYS);

  let n = 0;
  const next = () => uid(n++);

  const nodes: N8nNode[] = [];
  const connections: N8nWorkflow["connections"] = {};
  const connect = (from: string, to: string, outIndex = 0) => {
    if (!connections[from]) connections[from] = { main: [] };
    while (connections[from].main.length <= outIndex) connections[from].main.push([]);
    connections[from].main[outIndex].push({ node: to, type: "main", index: 0 });
  };

  // Static scaffold nodes.
  const webhook: N8nNode = {
    parameters: { httpMethod: "POST", path: webhookPath, responseMode: "responseNode", options: {} },
    id: next(), name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [-520, 320], notes: `POST body { action, payload, source, origin, idempotencyKey }.`,
  };
  const verifyIf: N8nNode = {
    parameters: {
      conditions: { options: { caseSensitive: true, typeValidation: "loose" }, combinator: "and", conditions: [
        { leftValue: "={{ $json.body.verify }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } },
      ] },
      options: {},
    },
    id: next(), name: "Verify probe?", type: "n8n-nodes-base.if", typeVersion: 2, position: [-320, 320],
    notes: "When the gateway's workflow verifier sends { verify: true }, short-circuit with a no-op acknowledgement so verification never touches the backend.",
  };
  const verifyRespond = codeNode(next(), "Verify ACK", `// No-op acknowledgement for the OmniProject workflow verifier.\nconst body = $('Webhook').first().json.body;\nconst caps = ${JSON.stringify(manifest.capabilities)};\nreturn [{ json: { success: true, data: { action: body.action, verified: true, backend: ${JSON.stringify(manifest.id)}, capabilities: caps }, message: 'verify ok' } }];`, [-120, 140]);
  const loopIf: N8nNode = {
    parameters: {
      conditions: { options: { caseSensitive: true, typeValidation: "loose" }, combinator: "and", conditions: [
        { leftValue: "={{ $json.body.origin }}", rightValue: "={{ $json.body.payload && $json.body.payload.lastUpdatedBy }}", operator: { type: "string", operation: "notEquals" } },
      ] },
      options: {},
    },
    id: next(), name: "Drop loop?", type: "n8n-nodes-base.if", typeVersion: 2, position: [-120, 460],
    notes: "Loop guard: drop echoes where origin === payload.lastUpdatedBy (best-effort; the gateway idempotency key is the primary dedupe).",
  };
  const dropLoop = codeNode(next(), "Drop (loop)", `return [{ json: { success: true, data: { dropped: true }, message: 'Loop mutation dropped' } }];`, [120, 620]);

  // Switch.
  const switchRules = actions.map((a) => ({
    conditions: { options: { caseSensitive: true, typeValidation: "loose" }, combinator: "and", conditions: [
      { leftValue: "={{ $json.body.action }}", rightValue: a, operator: { type: "string", operation: "equals" } },
    ] },
    renameOutput: true, outputKey: a,
  }));
  const routeNode: N8nNode = {
    parameters: { rules: { values: switchRules }, options: { fallbackOutput: "extra" } },
    id: next(), name: "Route Action", type: "n8n-nodes-base.switch", typeVersion: 3, position: [120, 320],
  };

  const normalize = codeNode(next(), "Normalize → N8nActionResult", `// Normalize the backend response to { success, data, message }.\nconst action = $('Webhook').first().json.body.action;\nconst rows = items.map((i) => i.json);\nconst data = rows.length === 1 ? rows[0] : rows;\nreturn [{ json: { success: true, data, message: action + ' ok' } }];`, [620, 320]);
  const unsupported = codeNode(next(), "Unsupported Action", `const action = $('Webhook').first().json.body.action;\nreturn [{ json: { success: false, data: {}, message: 'Unsupported action: ' + action } }];`, [620, 560]);
  const respond: N8nNode = {
    parameters: { respondWith: "firstIncomingItem", options: {} },
    id: next(), name: "Respond", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1, position: [880, 320],
  };

  nodes.push(webhook, verifyIf, verifyRespond, loopIf, dropLoop, routeNode, normalize, unsupported, respond);

  // Wire the scaffold.
  connect("Webhook", "Verify probe?");
  connect("Verify probe?", "Verify ACK", 0); // true
  connect("Verify probe?", "Drop loop?", 1); // false
  connect("Verify ACK", "Respond");
  connect("Drop loop?", "Route Action", 0); // true → proceed
  connect("Drop loop?", "Drop (loop)", 1); // false → drop
  connect("Drop (loop)", "Respond");
  connect("Normalize → N8nActionResult", "Respond");
  connect("Unsupported Action", "Respond");

  // Per-action nodes + wiring (Switch output order matches `actions`).
  let y = 80;
  actions.forEach((action, i) => {
    let node: N8nNode;
    if (action === ALWAYS) {
      node = codeNode(next(), "Capabilities", `// Declare which domains your wired backend(s) can populate. Edit to match.\nreturn [{ json: { success: true, data: ${JSON.stringify(manifest.capabilities)} } }];`, [380, y]);
      nodes.push(node);
      connect("Route Action", node.name, i);
      connect(node.name, "Respond");
    } else {
      const mapping = manifest.actions[action]!;
      node = mapping.kind === "n8nNode"
        ? nativeNode(next(), titleFor(action), mapping, manifest, [380, y])
        : httpNode(next(), titleFor(action), mapping, manifest, [380, y]);
      nodes.push(node);
      connect("Route Action", node.name, i);
      connect(node.name, "Normalize → N8nActionResult");
    }
    y += 180;
  });
  // Fallback output (after all rule outputs) → Unsupported.
  connect("Route Action", "Unsupported Action", actions.length);

  return {
    name: `OmniProject — ${manifest.label}`,
    meta: { templateId: `omniproject-${manifest.id}`, description: `Generated OmniProject contract workflow for ${manifest.label}. Set env: ${manifest.requiredEnv.join(", ")}.` },
    active: false,
    settings: { executionOrder: "v1" },
    pinData: {},
    nodes,
    connections,
  };
}

function titleFor(action: ContractAction): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
