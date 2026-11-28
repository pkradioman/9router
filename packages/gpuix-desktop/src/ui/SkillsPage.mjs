// Native Skills page: the published agent-skill list.
//
// Mirrors src/shared/constants/skills.js (single source in the gateway). The
// raw URL is shown so it can be copied from the window; GPUIX has no clipboard
// helper, so there is no copy button here.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;

const RAW_BASE = "https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills";

const SKILLS = [
  { id: "9router", name: "9Router (Entry)", description: "Setup + index of all capabilities; start here.", endpoint: null },
  { id: "9router-chat", name: "Chat", description: "Chat / code-gen via OpenAI or Anthropic format with streaming.", endpoint: "/v1/chat/completions" },
  { id: "9router-image", name: "Image Generation", description: "Text-to-image via DALL-E, Imagen, FLUX, MiniMax, SDWebUI.", endpoint: "/v1/images/generations" },
  { id: "9router-tts", name: "Text-to-Speech", description: "OpenAI / ElevenLabs / Edge / Google / Deepgram voices.", endpoint: "/v1/audio/speech" },
  { id: "9router-stt", name: "Speech-to-Text", description: "Transcribe audio via Whisper, Groq, Gemini, Deepgram, AssemblyAI.", endpoint: "/v1/audio/transcriptions" },
  { id: "9router-embeddings", name: "Embeddings", description: "Vectors for RAG / semantic search.", endpoint: "/v1/embeddings" },
  { id: "9router-web-search", name: "Web Search", description: "Web and X search via Tavily / Exa / Brave / Serper / SearXNG.", endpoint: "/v1/search" },
  { id: "9router-web-fetch", name: "Web Fetch", description: "URL to markdown / text / HTML via Firecrawl, Jina, Tavily, Exa.", endpoint: "/v1/web/fetch" },
];

export function SkillsPage() {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        height: "100%",
        overflowY: "scroll",
        padding: 24,
        gap: 16,
      },
    },
    h(
      "div",
      {
        testId: "skills-section",
        style: {
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 16,
          gap: 8,
        },
      },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Agent skills"),
      ...SKILLS.map((skill) =>
        h(
          "div",
          {
            key: skill.id,
            testId: `skill-${skill.id}`,
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingTop: 6,
              paddingBottom: 6,
              borderTopWidth: 1,
              borderColor: theme.border,
            },
          },
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", gap: 10, alignItems: "center" } },
            h("text", { style: { color: theme.text, fontSize: 12, fontWeight: 600 } }, skill.name),
            skill.endpoint
              ? h("text", { style: { color: theme.ok, fontSize: 10 } }, skill.endpoint)
              : h("text", { style: { color: theme.warn, fontSize: 10 } }, "START HERE")
          ),
          h("text", { style: { color: theme.muted, fontSize: 11 } }, skill.description),
          h("text", { style: { color: theme.muted, fontSize: 10 } }, `${RAW_BASE}/${skill.id}/SKILL.md`)
        )
      ),
      h(
        "text",
        { style: { color: theme.muted, fontSize: 11 } },
        "Copy a raw URL into any agent to install the skill."
      )
    )
  );
}
