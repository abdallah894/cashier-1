import { NextRequest } from "next/server";

import { POST } from "../app/api/groq/route";

const originalFetch = global.fetch;
process.env.GROQ_API_KEY = "test-key";
delete process.env.GEMINI_API_KEY;

const requests: Array<{ url: string }> = [];
global.fetch = (async (input) => {
  requests.push({ url: String(input) });
  return Response.json({
    choices: [{ message: { content: "Groq works." }, finish_reason: "stop" }],
  });
}) as typeof fetch;

void (async () => {
  try {
    const response = await POST(
      new NextRequest("http://localhost/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello", history: [] }),
      })
    );
    const body = await response.json();
    if (response.status !== 200 || body.received !== "Groq works.") {
      throw new Error(
        `Expected Groq response, received ${response.status}: ${JSON.stringify(body)}`
      );
    }
    if (requests[0]?.url !== "https://api.groq.com/openai/v1/chat/completions") {
      throw new Error(`Expected Groq chat endpoint, received ${requests[0]?.url}`);
    }
  } finally {
    global.fetch = originalFetch;
  }
})();
