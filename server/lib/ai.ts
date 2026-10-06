/* Claude calls with forced tool use, so every answer comes back as schema-shaped JSON. */
import Anthropic from '@anthropic-ai/sdk';
import { ENV, HttpError, need } from './env.js';

let client: Anthropic | null = null;
function anthropic() {
  need('ANTHROPIC_API_KEY');
  if (!client) client = new Anthropic({ apiKey: ENV.anthropicKey, maxRetries: 1, timeout: 50_000 });
  return client;
}

export type Tool = { name: string; description: string; input_schema: Record<string, any> };

export async function callTool<T>(opts: { model: string; system: string; user: string; tool: Tool; maxTokens?: number; temperature?: number }): Promise<T> {
  try {
    const res = await anthropic().messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      tools: [opts.tool as any],
      tool_choice: { type: 'tool', name: opts.tool.name },
    });
    const block: any = res.content.find((b: any) => b.type === 'tool_use');
    if (!block || typeof block.input !== 'object') throw new HttpError(502, 'The AI returned an empty answer. Try again.', 'ai_empty');
    return block.input as T;
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    const status = Number(e?.status || 0);
    if (status === 429 || status === 529) throw new HttpError(503, 'The AI is busy right now. Try again in a few seconds.', 'ai_busy');
    if (status === 401 || status === 403) throw new HttpError(503, 'The AI key is not valid. Check ANTHROPIC_API_KEY.', 'ai_auth');
    if (status === 404) throw new HttpError(503, `The AI model "${opts.model}" is not available on this API key.`, 'ai_model');
    if (status === 400) throw new HttpError(502, 'The AI rejected the request. Try rephrasing.', 'ai_bad_request');
    console.error('[ai] error', e?.message || e);
    throw new HttpError(502, 'The AI did not answer in time. Try again.', 'ai_error');
  }
}

/** Keep model-written text plain and short before it reaches the page. */
export const plain = (s: unknown, n: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '';
