import { AIChatAgent, type OnChatMessageOptions } from 'agents/ai-chat-agent';
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import type { Env } from '@/types/env';
import { getOpalTools } from '@/agents/tools';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are Opal, the conversational assistant embedded in a luxury-retail
personalization platform for Coach / Tapestry. You help merchandisers and CRM managers
understand their customers and act on Optimizely Feature Experimentation.

Operating rules:
- For ANY question about audience size, behaviour, revenue or segment performance, call
  queryAudienceData. Aggregate-then-reason: rely on the returned summary numbers and explain
  them plainly. Never invent raw customer rows.
- Only call createOptimizelyAudience or createFlag when the user explicitly asks to create one.
  These are write actions and may be gated; if a tool returns status "stubbed", tell the user
  exactly what WOULD be created and that writes are currently disabled.
- Be concise, concrete and merchandising-savvy. Prefer numbers and a recommended next step.`;

/**
 * OpalAgent — an AIChatAgent Durable Object that runs a Gemini streamText tool loop.
 *
 * Transport, message persistence (SQLite) and the chat protocol are provided by the
 * Cloudflare Agents SDK (`AIChatAgent`). We only implement the model turn.
 */
export class OpalAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions
  ): Promise<Response | undefined> {
    const apiKey = this.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response('GEMINI_API_KEY is not configured', { status: 500 });
    }

    const google = createGoogleGenerativeAI({ apiKey });
    const modelId = this.env.GEMINI_MODEL || DEFAULT_MODEL;
    const tools = getOpalTools(this.env);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: google(modelId),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(this.messages),
          tools,
          // Allow the model to call a tool and then continue with the result.
          stopWhen: stepCountIs(5),
          abortSignal: options?.abortSignal,
          onFinish,
        });
        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}
