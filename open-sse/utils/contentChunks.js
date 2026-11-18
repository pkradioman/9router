// Some OpenAI-compatible upstreams (Mistral with thinking enabled) return
// `content` as an array of typed chunks instead of a string:
//
//   [{"type":"thinking","thinking":[{"type":"text","text":"..."}],"closed":true},
//    {"type":"text","text":"Four"}]
//
// OpenAI clients (ai-sdk / @ai-sdk/openai-compatible, and therefore opencode)
// validate `delta.content` as `string | null | undefined` and abort the whole
// turn with "Invalid ... stream event / Expected string ... at
// choices[0].delta.content". Flatten it to the OpenAI shape instead:
// thinking chunks become `reasoning_content`, text chunks become `content`.

function collectText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  let out = "";
  for (const part of value) {
    if (typeof part === "string") out += part;
    else if (part && typeof part.text === "string") out += part.text;
    else if (part && Array.isArray(part.thinking)) out += collectText(part.thinking);
  }
  return out;
}

// Returns { text, reasoning } when `content` is a chunk array, else null.
export function flattenContentChunks(content) {
  if (!Array.isArray(content)) return null;
  let text = "";
  let reasoning = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "thinking") {
      reasoning += collectText(part.thinking ?? part.text);
    } else if (part.type === "text") {
      text += collectText(part.text);
    } else if (typeof part.text === "string") {
      // Unrecognized part type that still carries text (e.g. "output_text").
      text += part.text;
    }
  }
  return { text, reasoning };
}

// Normalize a streamed OpenAI chunk in place. Returns true when it changed.
export function normalizeOpenAIChatChunk(chunk) {
  if (!chunk || !Array.isArray(chunk.choices)) return false;
  let changed = false;
  for (const choice of chunk.choices) {
    if (!choice || typeof choice !== "object") continue;
    const delta = choice.delta;
    if (delta && typeof delta === "object") {
      const flat = flattenContentChunks(delta.content);
      if (flat) {
        delta.content = flat.text;
        if (flat.reasoning && delta.reasoning_content == null) {
          delta.reasoning_content = flat.reasoning;
        }
        changed = true;
      }
    }
    // Mistral attaches its own validation report to every terminal chunk.
    if (choice.response_error !== undefined) {
      delete choice.response_error;
      changed = true;
    }
  }
  return changed;
}

// Normalize a non-streaming OpenAI chat completion in place. Returns true when
// it changed.
export function normalizeOpenAIChatResponse(body) {
  if (!body || !Array.isArray(body.choices)) return false;
  let changed = false;
  for (const choice of body.choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = choice.message;
    if (message && typeof message === "object") {
      const flat = flattenContentChunks(message.content);
      if (flat) {
        message.content = flat.text;
        if (flat.reasoning && message.reasoning_content == null) {
          message.reasoning_content = flat.reasoning;
        }
        changed = true;
      }
    }
    if (choice.response_error !== undefined) {
      delete choice.response_error;
      changed = true;
    }
  }
  return changed;
}
