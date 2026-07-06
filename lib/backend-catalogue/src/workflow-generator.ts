import type { BackendDefinition, ActionMapping } from "./backend-catalogue";
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

interface WorkflowNode {
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
  nodes: WorkflowNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: "main"; index: number }>> }>;
}

// Deterministic UUID-shaped ids (n8n references nodes by name in connections,
// but ids must still be unique and well-formed).
function uid(i: number): string {
  const h = i.toString(16).padStart(12, "0");
  return `aaaaaaaa-0000-4000-8000-${h}`;
}

const ALWAYS: ContractAction = "get_capabilities";

// Write-ness is a property of the CONTRACT action, not the transport: an HTTP mapping's
// method is meaningless for an "n8nNode" mapping (it uses parameters.operation instead), so
// checking the mapping would silently under-classify every native-node write action. The
// contract action set is closed to these six names, so checking the action name directly is
// exhaustive regardless of which transport a given backend uses for it.
const WRITE_ACTIONS: ReadonlySet<ContractAction> = new Set(["create_issue", "update_issue", "delete_issue"]);
function isWrite(action: ContractAction): boolean {
  return WRITE_ACTIONS.has(action);
}

function credPlaceholder(manifest: BackendDefinition, credType: string): Record<string, { id: string; name: string }> {
  return { [credType]: { id: "", name: `${manifest.label} account` } };
}

/** Shared tail for both node kinds: attach the resolved credential placeholder and carry the mapping's note through. */
function finishNode(node: WorkflowNode, credType: string | undefined, manifest: BackendDefinition, mapping: ActionMapping): WorkflowNode {
  if (credType) node.credentials = credPlaceholder(manifest, credType);
  if (mapping.note) node.notes = mapping.note;
  return node;
}

/** n8n IF/Switch condition boilerplate around a single condition entry. */
function singleCondition(leftValue: unknown, rightValue: unknown, operator: Record<string, unknown>) {
  return { options: { caseSensitive: true, typeValidation: "loose" }, combinator: "and", conditions: [{ leftValue, rightValue, operator }] };
}

function httpNode(id: string, name: string, mapping: ActionMapping, manifest: BackendDefinition, pos: [number, number], action: ContractAction): WorkflowNode {
  // An n8n-managed credential (e.g. Microsoft Dynamics OAuth) takes over auth;
  // otherwise we forward the active user's bearer token.
  const credType = mapping.credentialType ?? manifest.credentialType;

  const headerParameters: Array<{ name: string; value: string }> = [];
  if (!credType && manifest.authHeader) {
    headerParameters.push({ name: "Authorization", value: manifest.authHeader });
  }
  if (isWrite(action)) {
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

  const node: WorkflowNode = { parameters, id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos };
  return finishNode(node, credType, manifest, mapping);
}

function nativeNode(id: string, name: string, mapping: ActionMapping, manifest: BackendDefinition, pos: [number, number], action: ContractAction): WorkflowNode {
  if (!mapping.node) {
    throw new Error(`backend "${manifest.id}" action "${action}" declares kind: "n8nNode" but has no "node" type`);
  }
  const credType = mapping.credentialType ?? manifest.credentialType;
  const node: WorkflowNode = {
    parameters: mapping.parameters ?? {},
    id,
    name,
    type: mapping.node,
    typeVersion: mapping.typeVersion ?? 1,
    position: pos,
  };
  return finishNode(node, credType, manifest, mapping);
}

function codeNode(id: string, name: string, jsCode: string, pos: [number, number]): WorkflowNode {
  return { parameters: { jsCode }, id, name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos };
}

/** The webhook + verify/loop-guard scaffold nodes — identical for every backend. */
function buildScaffoldNodes(manifest: BackendDefinition, webhookPath: string, next: () => string) {
  const webhook: WorkflowNode = {
    parameters: { httpMethod: "POST", path: webhookPath, responseMode: "responseNode", options: {} },
    id: next(), name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [-520, 320], notes: `POST body { action, payload, source, origin, idempotencyKey }.`,
  };
  const verifyIf: WorkflowNode = {
    parameters: {
      conditions: singleCondition("={{ $json.body.verify }}", true, { type: "boolean", operation: "true", singleValue: true }),
      options: {},
    },
    id: next(), name: "Verify probe?", type: "n8n-nodes-base.if", typeVersion: 2, position: [-320, 320],
    notes: "When the gateway's workflow verifier sends { verify: true }, short-circuit with a no-op acknowledgement so verification never touches the backend.",
  };
  const verifyRespond = codeNode(next(), "Verify ACK", `// No-op acknowledgement for the OmniProject workflow verifier.\nconst body = $('Webhook').first().json.body;\nconst caps = ${JSON.stringify(manifest.capabilities)};\nreturn [{ json: { success: true, data: { action: body.action, verified: true, backend: ${JSON.stringify(manifest.id)}, capabilities: caps }, message: 'verify ok' } }];`, [-120, 140]);
  const loopIf: WorkflowNode = {
    parameters: {
      conditions: singleCondition("={{ $json.body.origin }}", "={{ $json.body.payload && $json.body.payload.lastUpdatedBy }}", { type: "string", operation: "notEquals" }),
      options: {},
    },
    id: next(), name: "Drop loop?", type: "n8n-nodes-base.if", typeVersion: 2, position: [-120, 460],
    notes: "Loop guard: drop echoes where origin === payload.lastUpdatedBy (best-effort; the gateway idempotency key is the primary dedupe).",
  };
  const dropLoop = codeNode(next(), "Drop (loop)", `return [{ json: { success: true, data: { dropped: true }, message: 'Loop mutation dropped' } }];`, [120, 620]);
  return { webhook, verifyIf, verifyRespond, loopIf, dropLoop };
}

/** The Switch node that routes on `$json.body.action`, one rule per contract action. */
function buildSwitchNode(actions: ContractAction[], next: () => string): WorkflowNode {
  const switchRules = actions.map((a) => ({
    conditions: singleCondition("={{ $json.body.action }}", a, { type: "string", operation: "equals" }),
    renameOutput: true, outputKey: a,
  }));
  return {
    parameters: { rules: { values: switchRules }, options: { fallbackOutput: "extra" } },
    id: next(), name: "Route Action", type: "n8n-nodes-base.switch", typeVersion: 3, position: [120, 320],
  };
}

/** The post-route nodes: normalize the per-action result, the unsupported-action fallback, and the final respond. */
function buildResponseNodes(next: () => string) {
  const normalize = codeNode(next(), "Normalize → BrokerActionResult", `// Normalize the backend response to { success, data, message }.\nconst action = $('Webhook').first().json.body.action;\nconst rows = items.map((i) => i.json);\nconst data = rows.length === 1 ? rows[0] : rows;\nreturn [{ json: { success: true, data, message: action + ' ok' } }];`, [620, 320]);
  const unsupported = codeNode(next(), "Unsupported Action", `const action = $('Webhook').first().json.body.action;\nreturn [{ json: { success: false, data: {}, message: 'Unsupported action: ' + action } }];`, [620, 560]);
  const respond: WorkflowNode = {
    parameters: { respondWith: "firstIncomingItem", options: {} },
    id: next(), name: "Respond", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1, position: [880, 320],
  };
  return { normalize, unsupported, respond };
}

/** A connections map plus the mutable `connect` helper that builds it (n8n wires nodes by name, output-index-addressed). */
function createConnectionGraph(): { connections: N8nWorkflow["connections"]; connect: (from: string, to: string, outIndex?: number) => void } {
  const connections: N8nWorkflow["connections"] = {};
  const connect = (from: string, to: string, outIndex = 0) => {
    const conn = (connections[from] ??= { main: [] });
    while (conn.main.length <= outIndex) conn.main.push([]);
    conn.main[outIndex]!.push({ node: to, type: "main", index: 0 }); // loop above grew main past outIndex
  };
  return { connections, connect };
}

/** Per-action nodes (Switch output order matches `actions`), wired to Route Action and onward to Normalize/Respond. */
function buildActionNodes(
  manifest: BackendDefinition,
  actions: ContractAction[],
  next: () => string,
  connect: (from: string, to: string, outIndex?: number) => void,
): WorkflowNode[] {
  const nodes: WorkflowNode[] = [];
  let y = 80;
  actions.forEach((action, i) => {
    let node: WorkflowNode;
    if (action === ALWAYS) {
      node = codeNode(next(), "Capabilities", `// Declare which domains your wired backend(s) can populate. Edit to match.\nreturn [{ json: { success: true, data: ${JSON.stringify(manifest.capabilities)} } }];`, [380, y]);
      nodes.push(node);
      connect("Route Action", node.name, i);
      connect(node.name, "Respond");
    } else {
      const mapping = manifest.actions[action]!;
      node = mapping.kind === "n8nNode"
        ? nativeNode(next(), titleFor(action), mapping, manifest, [380, y], action)
        : httpNode(next(), titleFor(action), mapping, manifest, [380, y], action);
      nodes.push(node);
      connect("Route Action", node.name, i);
      connect(node.name, "Normalize → BrokerActionResult");
    }
    y += 180;
  });
  // Fallback output (after all rule outputs) → Unsupported.
  connect("Route Action", "Unsupported Action", actions.length);
  return nodes;
}

/**
 * Generate an importable n8n workflow JSON for a backend from its binding.
 *
 * `opts.readOnly` omits every write action (create_issue/update_issue/delete_issue,
 * regardless of transport) outright — not "generate then delete the node yourself",
 * the workflow never has a write node to begin with, so there's no write path to disable.
 */
export function generateWorkflow(manifest: BackendDefinition, opts: { webhookPath?: string; readOnly?: boolean } = {}): N8nWorkflow {
  const webhookPath = opts.webhookPath?.trim() || "omniproject";
  let actions = Object.keys(manifest.actions) as ContractAction[];
  if (opts.readOnly) actions = actions.filter((a) => !isWrite(a));
  if (!actions.includes(ALWAYS)) actions.push(ALWAYS);

  let n = 0;
  const next = () => uid(n++);
  const { connections, connect } = createConnectionGraph();

  const { webhook, verifyIf, verifyRespond, loopIf, dropLoop } = buildScaffoldNodes(manifest, webhookPath, next);
  const routeNode = buildSwitchNode(actions, next);
  const { normalize, unsupported, respond } = buildResponseNodes(next);

  const nodes: WorkflowNode[] = [webhook, verifyIf, verifyRespond, loopIf, dropLoop, routeNode, normalize, unsupported, respond];

  // Wire the scaffold.
  connect("Webhook", "Verify probe?");
  connect("Verify probe?", "Verify ACK", 0); // true
  connect("Verify probe?", "Drop loop?", 1); // false
  connect("Verify ACK", "Respond");
  connect("Drop loop?", "Route Action", 0); // true → proceed
  connect("Drop loop?", "Drop (loop)", 1); // false → drop
  connect("Drop (loop)", "Respond");
  connect("Normalize → BrokerActionResult", "Respond");
  connect("Unsupported Action", "Respond");

  nodes.push(...buildActionNodes(manifest, actions, next, connect));

  const readOnlySuffix = opts.readOnly ? " (read-only)" : "";
  const readOnlyNote = opts.readOnly ? " Read-only: no write actions are included — this workflow cannot mutate the backend." : "";
  return {
    name: `OmniProject — ${manifest.label}${readOnlySuffix}`,
    meta: { templateId: `omniproject-${manifest.id}`, description: `Generated OmniProject contract workflow for ${manifest.label}.${readOnlyNote} Set env: ${manifest.requiredEnv.join(", ")}.` },
    active: false,
    settings: { executionOrder: "v1" },
    pinData: {},
    nodes,
    connections,
  };
}

/** The node title a contract action gets in the generated workflow (e.g. "create_issue" → "Create Issue"). */
export function titleFor(action: ContractAction): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
