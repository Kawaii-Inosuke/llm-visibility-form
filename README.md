# LLM Visibility Tracker — intake form

Static form + one serverless function. The form posts a job to `/api/submit`,
which writes it into `jobs/pending/` of the private queue repo. The laptop
watcher takes it from there. Contract: `docs/form-contract.md` in the code repo.

## Deploy (Vercel)
1. Push this folder to its own GitHub repo (e.g. `llm-visibility-form`).
2. On vercel.com: New Project -> import that repo -> Deploy (no build settings needed).
3. Project -> Settings -> Environment Variables, add two (Production + Preview):
   - `QUEUE_REPO` = `Kawaii-Inosuke/llm-visibility-queue`
   - `QUEUE_TOKEN` = the fine-grained token (Contents: read and write on the queue repo)
4. Redeploy so the env vars take effect.

The token lives only in Vercel's env, never in the browser. When you rotate it,
update it here AND in the laptop's `.env`.

## Local test (optional)
`npx vercel dev` with the two env vars in a local `.env` (gitignored).
