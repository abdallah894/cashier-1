import { NextRequest } from "next/server";

import { POST } from "../app/api/gemini/route";

const originalFetch = global.fetch;
const requests: Array<{ url: string; body: { contents: Array<{ role: string }> } }> = [];

process.env.GEMINI_API_KEY = "test-key";

global.fetch = (async (input, init) => {
  const body = JSON.parse(String(init?.body)) as { contents: Array<{ role: string }> };
  requests.push({ url: String(input), body });

  if (requests.length === 1) {
    return Response.json({
      candidates: [
        {
          content: { parts: [{ functionCall: { name: "unknownTool", args: {} } }] },
          finishReason: "STOP",
        },
      ],
    });
  }

  return Response.json({
    candidates: [
      {
        content: { parts: [{ text: "Sales data is unavailable." }] },
        finishReason: "STOP",
      },
    ],
  });
}) as typeof fetch;

void (async () => {
  try {
    const request = new NextRequest("http://localhost/api/gemini", {
      method: "POST",
      body: JSON.stringify({ message: "What are today's sales?", history: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);

    if (response.status !== 200) throw new Error(`Expected 200, received ${response.status}`);
    if (!requests[0]?.url.includes("/gemini-3.6-flash:generateContent")) {
      throw new Error(
        `Expected gemini-3.6-flash as the primary model; received ${requests[0]?.url}`
      );
    }
    if (requests[1]?.body.contents[2]?.role !== "user") {
      throw new Error(
        `Expected the function response to use the user role; received ${requests[1]?.body.contents[2]?.role}`
      );
    }
  } finally {
    global.fetch = originalFetch;
  }

  console.log("Gemini tool-response role test passed");
})();
