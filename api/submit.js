// Vercel serverless function. Holds the GitHub token server-side and writes
// one job file into jobs/pending/ of the queue repo. The browser never sees
// the token. Contract: docs/form-contract.md in the code repo.

const ENGINES = ["chatgpt","gemini","claude","perplexity","copilot","ai_overview","ai_mode"];

function makeJobId() {
  const n = new Date();
  const p = (x, w = 2) => String(x).padStart(w, "0");
  const stamp = `${n.getUTCFullYear()}${p(n.getUTCMonth()+1)}${p(n.getUTCDate())}`
              + `-${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}`;
  const bytes = new Uint8Array(2);
  (globalThis.crypto || require("crypto").webcrypto).getRandomValues(bytes);
  const rand = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${stamp}-${rand}`;
}

function validate(b) {
  if (typeof b !== "object" || b === null) return "Malformed request.";
  if (typeof b.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email))
    return "A valid email is required.";
  if (b.region !== "us" && b.region !== "in") return "Region must be us or in.";
  const runs = b.runs_per_prompt;
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) return "Runs per prompt must be 1 to 10.";
  if (!Array.isArray(b.engines) || b.engines.length === 0) return "Pick at least one engine.";
  if (b.engines.some(e => !ENGINES.includes(e))) return "Unknown engine in the list.";
  if (new Set(b.engines).size !== b.engines.length) return "Duplicate engine in the list.";
  if (!Array.isArray(b.prompts) || b.prompts.length === 0) return "Add at least one prompt.";
  for (const p of b.prompts) {
    if (!p || typeof p.id !== "string" || !p.id.trim()) return "A prompt is missing its id.";
    if (typeof p.prompt !== "string" || !p.prompt.trim()) return "A prompt is empty.";
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const repo = process.env.QUEUE_REPO;      // Kawaii-Inosuke/llm-visibility-queue
  const token = process.env.QUEUE_TOKEN;
  if (!repo || !token) {
    res.status(500).json({ error: "Server not configured." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }

  const bad = validate(body);
  if (bad) { res.status(400).json({ error: bad }); return; }

  const jobId = makeJobId();
  const job = {
    job_id: jobId,
    submitted_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    email: body.email.trim(),
    region: body.region,
    runs_per_prompt: body.runs_per_prompt,
    engines: body.engines,
    prompts: body.prompts.map(p => ({ id: p.id.trim(), prompt: p.prompt.trim() })),
    status: "pending",
    message: null,
  };

  const text = JSON.stringify(job, null, 2) + "\n";
  const content = Buffer.from(text, "utf8").toString("base64");
  const url = `https://api.github.com/repos/${repo}/contents/jobs/pending/${jobId}.json`;

  try {
    const gh = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "llm-visibility-form",
      },
      body: JSON.stringify({
        message: `job ${jobId} from ${job.email}`,
        content,
        branch: "main",
      }),
    });

    if (gh.status === 201) { res.status(201).json({ ok: true, job_id: jobId }); return; }

    // Don't leak auth detail to the browser; log for the operator.
    console.error("GitHub PUT failed", gh.status, await gh.text().catch(() => ""));
    if (gh.status === 401 || gh.status === 403 || gh.status === 404) {
      res.status(502).json({ error: "The queue is unavailable right now. Please tell the operator." });
    } else if (gh.status === 422) {
      res.status(409).json({ error: "Please try again." });
    } else {
      res.status(502).json({ error: "Could not queue the job. Please try again." });
    }
  } catch (e) {
    console.error("submit error", e);
    res.status(502).json({ error: "Could not reach the queue. Please try again." });
  }
};
