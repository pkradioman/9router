// Native chat: a minimal non-streaming client for the gateway's OpenAI route.
//
// The dashboard chat streams through /api/dashboard/chat/completions, which is
// not in the staged runtime; GPUIX calls /v1/chat/completions instead and can
// only render a finished reply. Prompts are single-line (no masked/multiline
// field), and long replies are hard-wrapped in the transcript.
import React from "react";
import { theme } from "./theme.mjs";

const h = React.createElement;
const CHUNK = 96;

export function wrapText(text, chunk = CHUNK) {
  const lines = [];
  for (const raw of String(text ?? "").split("\n")) {
    if (raw.length === 0) {
      lines.push("");
      continue;
    }
    for (let i = 0; i < raw.length; i += chunk) lines.push(raw.slice(i, i + chunk));
  }
  return lines;
}

export function ChatPage({ api }) {
  const [models, setModels] = React.useState(null);
  const [keys, setKeys] = React.useState([]);
  const [modelFilter, setModelFilter] = React.useState("");
  const [model, setModel] = React.useState("");
  const [keyId, setKeyId] = React.useState("");
  const [system, setSystem] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [messages, setMessages] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    Promise.all([api.getModels(), api.listKeys()])
      .then(([list, keyList]) => {
        setModels(list || []);
        setKeys(keyList || []);
        if ((list || []).length > 0) setModel((current) => current || list[0].routedModel || list[0].fullModel);
        const active = (keyList || []).find((item) => item.isActive !== false);
        if (active) setKeyId(active.id);
      })
      .catch((err) => {
        setModels([]);
        setError(err.message);
      });
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const matchingModels = React.useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    const list = models || [];
    const filtered = query
      ? list.filter((item) => (item.model || "").toLowerCase().includes(query) || (item.fullModel || "").toLowerCase().includes(query))
      : list;
    return filtered.slice(0, 12);
  }, [models, modelFilter]);

  const apiKey = (keys.find((item) => item.id === keyId) || {}).key || null;

  const send = () => {
    const text = draft.trim();
    if (!text || !model || busy) return;
    const next = [...messages, { role: "user", content: text }];
    const payload = [
      ...(system.trim() ? [{ role: "system", content: system.trim() }] : []),
      ...next,
    ];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    api
      .createChatCompletion({ apiKey, model, messages: payload })
      .then((body) => {
        const content = body?.choices?.[0]?.message?.content;
        setMessages((list) => [
          ...list,
          { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content ?? "") },
        ]);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const chip = (testId, label, onClick, active) =>
    h(
      "text",
      {
        testId,
        role: "button",
        onClick: busy ? null : onClick,
        style: {
          color: busy ? theme.muted : active ? theme.ok : theme.muted,
          fontSize: 10,
          cursor: busy ? "default" : "pointer",
          hover: busy ? {} : { color: theme.text },
        },
      },
      label
    );

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        height: "100%",
        padding: 24,
        gap: 12,
      },
    },
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" } },
      h("text", { style: { color: theme.text, fontSize: 14, fontWeight: 600 } }, "Chat"),
      chip("chat-clear", "Clear conversation", () => setMessages([]), false),
      h(
        "text",
        { testId: "chat-status", style: { color: busy ? theme.warn : theme.muted, fontSize: 10 } },
        busy ? "Waiting for the reply..." : `${messages.length} messages`
      )
    ),
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      h("input", {
        testId: "chat-model-filter",
        "aria-label": "Filter models",
        value: modelFilter,
        onChange: (event) => setModelFilter(event.value ?? ""),
        placeholder: "filter models",
        style: { width: 180, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
      }),
      ...matchingModels.map((item) =>
        chip(
          `chat-model-${item.routedModel || item.fullModel}`,
          item.alias || item.model,
          () => setModel(item.routedModel || item.fullModel),
          model === (item.routedModel || item.fullModel)
        )
      ),
      models !== null && matchingModels.length === 0
        ? h("text", { style: { color: theme.muted, fontSize: 10 } }, "No models match.")
        : null
    ),
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      h("text", { style: { color: theme.muted, fontSize: 10 } }, "API key:"),
      keys.length === 0
        ? h("text", { testId: "chat-no-key", style: { color: theme.warn, fontSize: 10 } }, "No key — create one on Endpoint & Key")
        : keys.map((item) =>
            chip(`chat-key-${item.id}`, item.name, () => setKeyId(item.id), keyId === item.id)
          ),
      h(
        "text",
        { testId: "chat-selected-model", style: { color: theme.text, fontSize: 10, flexGrow: 1 } },
        model || "no model selected"
      )
    ),
    h(
      "div",
      {
        testId: "chat-transcript",
        style: {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          backgroundColor: theme.panel,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          padding: 12,
          gap: 2,
        },
      },
      messages.length === 0
        ? h("text", { testId: "chat-empty", style: { color: theme.muted, fontSize: 11 } }, "No messages yet.")
        : messages.map((message, index) =>
            h(
              "div",
              { key: `${index}-${message.role}`, style: { display: "flex", flexDirection: "column", paddingTop: 4, paddingBottom: 4 } },
              h(
                "text",
                {
                  testId: `chat-message-${index}`,
                  style: {
                    color: message.role === "assistant" ? theme.ok : theme.text,
                    fontSize: 10,
                    fontWeight: 600,
                  },
                },
                message.role
              ),
              ...wrapText(message.content).map((line, lineIndex) =>
                h(
                  "text",
                  {
                    key: lineIndex,
                    style: { color: theme.text, fontSize: 11, fontFamily: "Consolas" },
                  },
                  line === "" ? " " : line
                )
              )
            )
          )
    ),
    error ? h("text", { testId: "chat-error", style: { color: theme.bad, fontSize: 11 } }, error) : null,
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      h("input", {
        testId: "chat-system",
        "aria-label": "System prompt",
        value: system,
        onChange: (event) => setSystem(event.value ?? ""),
        placeholder: "system prompt (optional)",
        style: { width: 260, height: 26, color: theme.text, backgroundColor: theme.panelAlt },
      }),
      h("input", {
        testId: "chat-input",
        "aria-label": "Message",
        value: draft,
        onChange: (event) => setDraft(event.value ?? ""),
        onSubmit: send,
        placeholder: "Message",
        style: { flexGrow: 1, minWidth: 220, height: 30, color: theme.text, backgroundColor: theme.panelAlt },
      }),
      h(
        "text",
        {
          testId: "chat-send",
          role: "button",
          onClick: busy ? null : send,
          style: {
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: 14,
            paddingRight: 14,
            borderRadius: 8,
            backgroundColor: theme.panelAlt,
            color: busy ? theme.muted : theme.text,
            fontSize: 11,
            cursor: busy ? "default" : "pointer",
            hover: busy ? {} : { backgroundColor: "#2e2e33" },
          },
        },
        busy ? "Sending..." : "Send"
      )
    ),
    h(
      "text",
      { style: { color: theme.muted, fontSize: 10 } },
      "Non-streaming through /v1/chat/completions; a send spends the selected provider account. Streaming and multiline prompts stay on the dashboard."
    )
  );
}
