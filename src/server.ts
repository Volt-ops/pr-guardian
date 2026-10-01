/**
 * server.ts — Express webhook server for PR Guardian.
 *
 * Listens for GitHub `pull_request` webhook events, verifies the HMAC
 * signature, and dispatches asynchronous review jobs via the orchestrator.
 */

import "dotenv/config";
import crypto from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { reviewPullRequest, type PullRequestRef } from "./orchestrator.js";

// ─── Configuration ──────────────────────────────────────────────────

const PORT = Number(process.env["PORT"]) || 3000;
const WEBHOOK_SECRET = process.env["GITHUB_WEBHOOK_SECRET"] ?? "";

// ─── HMAC signature verification ────────────────────────────────────

function verifySignature(
  payload: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !WEBHOOK_SECRET) return false;

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  const trusted = `sha256=${expected}`;

  // Constant-time comparison to prevent timing attacks.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, "utf8"),
      Buffer.from(trusted, "utf8"),
    );
  } catch {
    return false;
  }
}

// ─── Express app ────────────────────────────────────────────────────

const app = express();

// We need the raw body for HMAC verification, so we use a raw body parser
// and store the buffer on the request.
app.use(
  "/api/webhook",
  express.raw({ type: "application/json" }),
);

app.post(
  "/api/webhook",
  (req: Request, res: Response, _next: NextFunction): void => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-hub-signature-256"] as
      | string
      | undefined;

    // 1. Verify HMAC
    if (!verifySignature(rawBody, signature)) {
      console.warn("[server] ⚠ Invalid signature — rejecting request.");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // 2. Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      res.status(400).json({ error: "Malformed JSON" });
      return;
    }

    // 3. Filter for pull_request opened/synchronize events
    const event = req.headers["x-github-event"] as string | undefined;
    const action = payload["action"] as string | undefined;

    if (
      event !== "pull_request" ||
      (action !== "opened" && action !== "synchronize")
    ) {
      res.status(200).json({ message: "Event ignored" });
      return;
    }

    // 4. Extract PR metadata
    const pr = payload["pull_request"] as
      | Record<string, unknown>
      | undefined;
    const repoData = payload["repository"] as
      | Record<string, unknown>
      | undefined;

    if (!pr || !repoData) {
      res.status(400).json({ error: "Missing pull_request or repository" });
      return;
    }

    const repoFullName = repoData["full_name"] as string; // "owner/repo"
    const [owner, repo] = repoFullName.split("/") as [string, string];
    const pull_number = pr["number"] as number;

    const prRef: PullRequestRef = { owner, repo, pull_number };

    // 5. Dispatch async review (fire-and-forget so we respond to GitHub < 10s)
    reviewPullRequest(prRef).catch((err: unknown) => {
      console.error(
        "[server] Review job failed:",
        err instanceof Error ? err.message : err,
      );
    });

    console.log(
      `[server] ✓ Accepted review job for ${owner}/${repo}#${pull_number}`,
    );
    res.status(202).json({ message: "Review job accepted", pr: prRef });
  },
);

// ─── Health check ───────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Start ──────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] 🚀 PR Guardian listening on http://localhost:${PORT}`);
  console.log(`[server]    Webhook endpoint: POST /api/webhook`);
  console.log(`[server]    Health check:     GET  /health`);
});
