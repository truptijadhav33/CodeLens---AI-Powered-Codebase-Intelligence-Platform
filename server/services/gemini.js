const PRIMARY_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-flash-lite-latest";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3-flash-preview";

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return key;
}

function buildRagPrompt(question, chunks) {
  const contextBlocks = chunks
    .map((c, i) => `---\n[Chunk ${i + 1} | File: ${c.path}]\n${c.content}\n---`)
    .join("\n\n");

  return `You are CodeLens, an AI assistant that answers questions about a specific codebase.

Rules:
- Answer ONLY from the repository context provided below.
- If the answer is not in the context, say: "I don't have enough information in the retrieved context to answer that."
- Do not hallucinate file paths, functions, or behavior not present in the context.
- Be concise and cite which files you used when relevant.

Repository context:
${contextBlocks || "(No relevant context retrieved)"}

User question: ${question}

Provide a helpful answer grounded strictly in the context above.`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryGenerateWithModel(model, prompt, apiKey, { temperature = 0.3, maxOutputTokens = 1024 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        const isRetriable = res.status === 503 || res.status === 429;
        if (isRetriable) {
          const waitMs = 1500 * (attempt + 1);
          console.warn(`[ask] ${model} ${res.status} (attempt ${attempt + 1}/2), retrying in ${1500 * (attempt + 1)}ms`);
          await sleep(1500 * (attempt + 1));
          continue;
        }
        const err = new Error(`Gemini generateContent failed (${res.status}): ${errText}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const text =
        candidate?.content?.parts?.map((p) => p.text).join("") ||
        candidate?.content?.parts?.[0]?.text ||
        "";

      if (!text) throw new Error("Gemini returned empty answer");
      return { answer: text.trim() };
    } catch (err) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        console.warn(`[ask] timeout on ${model} (attempt ${attempt + 1}/2)`);
        if (attempt === 0) await sleep(1500);
        if (attempt === 0) continue;
      }
      if (err.status === 503 || err.status === 429 || /503|429|UNAVAILABLE|high demand/i.test(err.message)) {
        if (attempt === 0) {
          await sleep(1500);
          continue;
        }
      }
      throw err;
    } finally {
      // Timeout is handled by AbortController, no clearTimeout needed since AbortController handles it
    }
  }
  throw new Error(`Model ${model} failed after 2 attempts`);
}

async function generateText(prompt, { temperature = 0.3, maxOutputTokens = 1024 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];
    const isFallback = modelIdx === 1;
    const modelLabel = isFallback ? "fallback" : "primary";

    try {
      console.log(`[ask] trying ${modelLabel} model: ${models[modelIdx]}`);
      const result = await tryGenerateWithModel(models[modelIdx], prompt, apiKey, { temperature, maxOutputTokens });
      console.log(`[ask] ${modelLabel} model (${models[modelIdx]}) succeeded`);
      return { answer: result.answer };
    } catch (err) {
      const isLastModel = modelIdx === models.length - 1;
      const isRetriable =
        err.name === "AbortError" ||
        /503|429|UNAVAILABLE|high demand|overloaded|timeout|aborted/i.test(err.message);

      if (isLastModel || !isRetriable) {
        console.error(`[ask] All models failed. Last error: ${err.message}`);
        const error = new Error("The AI service is temporarily busy. Please try again in a moment.");
        error.status = 503;
        error.isRetryable = true;
        throw error;
      }
      console.warn(`[ask] ${models[modelIdx]} failed (${err.message}), trying fallback...`);
      await sleep(1000);
    }
  }
  throw new Error("The AI service is temporarily busy. Please try again in a moment.");
}

async function generateAnswer(question, relevantChunks) {
  const prompt = buildRagPrompt(question, relevantChunks);
  return generateText(prompt);
}

// Issue-explanation path: reuses the exact same model loop, timeout, retry, and
// fallback behavior as Q&A — just with a purpose-built prompt.
function buildIssuePrompt(issue) {
  const blocks = [`Repository file: ${issue.filePath} (issue type: ${issue.issueType})`, "", "Relevant code:", "```"].concat(
    (issue.excerpt || "").split("\n"),
    "```"
  );
  if (issue.relatedFilePath && issue.relatedExcerpt) {
    blocks.push("", `Related file: ${issue.relatedFilePath}`, "```");
    blocks.push(...(issue.relatedExcerpt || "").split("\n"), "```");
  }
  blocks.push("", `Detected issue: ${issue.message}`);

  return `You are CodeLens, an AI assistant that helps developers understand code-quality issues in their own codebase.

Explain the detected issue below in plain, actionable language a developer can act on.

Rules:
- Ground your explanation in the code excerpt provided. Do not invent file contents that are not shown.
- Be concise: 2-4 sentences for the explanation, then a concrete, specific suggestion.
- Format your response with EXACTLY two sections, each on a line like this:

EXPLANATION:
<why this matters and what the impact is>

SUGGESTION:
<a specific fix the developer can apply>

${blocks.join("\n")}`;
}

async function explainIssue(issue) {
  return generateText(buildIssuePrompt(issue), { temperature: 0.2, maxOutputTokens: 1024 });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { generateAnswer, generateText, explainIssue, buildRagPrompt, buildIssuePrompt, PRIMARY_MODEL, FALLBACK_MODEL };