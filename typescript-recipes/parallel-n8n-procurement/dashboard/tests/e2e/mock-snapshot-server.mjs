import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.SNAPSHOT_MOCK_PORT || 4111);
const writeToken = process.env.PROCUREMENT_DASHBOARD_WRITE_TOKEN || "test-write-token";
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "snapshot.json");
const seedSnapshot = JSON.parse(await readFile(fixturePath, "utf8"));

let snapshot = clone(seedSnapshot);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function send(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-procurement-dashboard-token",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function slugify(value) {
  return String(value || "vendor")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "vendor";
}

function normalizeRisk(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(normalized) ? normalized : "MEDIUM";
}

function recommendationFor(level) {
  if (level === "CRITICAL") return "suspend_relationship";
  if (level === "HIGH") return "initiate_contingency";
  if (level === "MEDIUM") return "escalate_review";
  return "continue_monitoring";
}

function dimensionsFor(level) {
  return [
    { key: "financial_health", label: "Financial health", severity: level, status: "watch", findings: "Dashboard write-back vendor pending review." },
    { key: "legal_regulatory", label: "Legal & regulatory", severity: "LOW", status: "stable", findings: "No active legal findings in the mock snapshot." },
    { key: "cybersecurity", label: "Cybersecurity", severity: "LOW", status: "stable", findings: "No active cyber findings in the mock snapshot." },
    { key: "leadership_governance", label: "Leadership & governance", severity: "LOW", status: "stable", findings: "No active governance findings in the mock snapshot." },
    { key: "esg_reputation", label: "ESG & reputation", severity: "LOW", status: "stable", findings: "No active reputation findings in the mock snapshot." },
  ];
}

function vendorFromInput(input) {
  const riskLevel = normalizeRisk(input.riskLevel);
  const vendorName = String(input.vendorName || "Unnamed vendor").trim();
  const domain = String(input.vendorDomain || `${slugify(vendorName)}.example`).trim();

  return {
    id: slugify(vendorName),
    vendorName,
    vendorDomain: domain.startsWith("http://") || domain.startsWith("https://") ? domain : `https://${domain}`,
    vendorCategory: String(input.vendorCategory || "vendor").trim().toLowerCase().replace(/\s+/g, "_"),
    monitoringPriority: input.monitoringPriority || "medium",
    relationshipOwner: input.relationshipOwner || "Procurement",
    region: input.region || "Global",
    riskLevel,
    overallRiskLevel: riskLevel,
    score: Number(input.score) || 50,
    actionRequired: riskLevel === "HIGH" || riskLevel === "CRITICAL",
    adverseFlag: riskLevel !== "LOW",
    recommendation: recommendationFor(riskLevel),
    summary: `${vendorName} was written through the mocked n8n mutation endpoint.`,
    movement: "+0 mock write",
    lastAssessmentDate: "2026-04-29",
    nextResearchDate: input.nextResearchDate || "2026-05-01",
    triggeredOverrides: [],
    dimensions: dimensionsFor(riskLevel),
    adverseEvents: [],
    evidence: [],
    monitors: [],
  };
}

function upsertVendor(vendor) {
  const next = snapshot.vendors.filter((current) => current.id !== vendor.id);
  next.push(vendor);
  snapshot.vendors = next.sort((left, right) => right.score - left.score);
  refreshDerivedFields();
}

function refreshDerivedFields() {
  const levels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const actionQueue = snapshot.vendors
    .filter((vendor) => vendor.actionRequired)
    .map((vendor) => ({
      vendorName: vendor.vendorName,
      owner: vendor.riskLevel === "CRITICAL" ? "Security operations" : "Procurement finance",
      deadline: vendor.riskLevel === "CRITICAL" ? "Due in 12h" : "Due in 24h",
      action: vendor.riskLevel === "CRITICAL"
        ? "Validate exposure, review contingency supplier path, and notify accountable stakeholders."
        : "Update the vendor risk memo and confirm mitigation owner.",
      riskLevel: vendor.riskLevel,
    }));

  const criticalCount = snapshot.vendors.filter((vendor) => vendor.riskLevel === "CRITICAL").length;
  const highCount = snapshot.vendors.filter((vendor) => vendor.riskLevel === "HIGH").length;

  snapshot = {
    ...snapshot,
    lastUpdated: new Date().toISOString(),
    riskDistribution: levels.map((level) => ({
      label: level,
      count: snapshot.vendors.filter((vendor) => vendor.riskLevel === level).length,
    })),
    actionQueue,
    metrics: snapshot.metrics.map((metric) => {
      if (metric.label === "Portfolio risk posture") {
        return {
          ...metric,
          value: `${criticalCount} CRITICAL / ${highCount} HIGH`,
          trend: `${actionQueue.length} vendors require immediate review`,
          tone: actionQueue.length ? "critical" : "positive",
        };
      }
      if (metric.label === "Action queue") {
        return {
          ...metric,
          value: `${actionQueue.length} escalations`,
          trend: `${actionQueue.filter((item) => item.deadline.includes("12h")).length} due in the next 12h`,
          tone: actionQueue.length ? "default" : "positive",
        };
      }
      return metric;
    }),
  };
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }

  if (request.url === "/health") {
    send(response, 200, { ok: true });
    return;
  }

  if (request.url === "/snapshot" && request.method === "GET") {
    send(response, 200, snapshot);
    return;
  }

  if (request.url === "/mutation" && request.method === "POST") {
    if (request.headers["x-procurement-dashboard-token"] !== writeToken) {
      send(response, 401, { ok: false, error: "missing or invalid dashboard write token" });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch {
      send(response, 400, { ok: false, error: "invalid json" });
      return;
    }

    const vendors = body.action === "addVendor" ? [body.vendor] : body.vendors;
    if (Array.isArray(vendors) && vendors.some((vendor) => vendor?.vendorName === "Mutation Failure")) {
      send(response, 500, { ok: false, error: "Forced mutation failure from mock n8n endpoint." });
      return;
    }

    if (body.action === "addVendor" && body.vendor) {
      upsertVendor(vendorFromInput(body.vendor));
      send(response, 200, { ok: true, action: body.action, affected: 1 });
      return;
    }

    if (body.action === "uploadVendors" && Array.isArray(body.vendors)) {
      body.vendors.forEach((vendor) => upsertVendor(vendorFromInput(vendor)));
      send(response, 200, { ok: true, action: body.action, affected: body.vendors.length });
      return;
    }

    if (body.action === "resetSeedVendors") {
      snapshot = clone(seedSnapshot);
      send(response, 200, { ok: true, action: body.action, affected: snapshot.vendors.length });
      return;
    }

    send(response, 400, { ok: false, error: "unsupported mutation action" });
    return;
  }

  send(response, 404, { ok: false, error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`snapshot mock listening on ${port}\n`);
});
