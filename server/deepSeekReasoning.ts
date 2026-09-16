const SSE_DATA_PREFIX = /^data:(\s?)/;

/**
 * The Agents SDK records `delta.reasoning`, while DeepSeek's OpenAI-compatible
 * stream returns `delta.reasoning_content`. Mirror the vendor field before the
 * SDK consumes the stream so reasoning stays attached to the model turn that
 * produced it instead of being reconstructed later from observer events.
 */
export function normalizeDeepSeekReasoningResponse(
  response: Response,
  onReasoningContent?: () => void
): Response {
  if (
    !response.body ||
    !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
  ) {
    return response;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  const normalizeLine = (line: string): string => {
    const lineEnding = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
    const content = lineEnding ? line.slice(0, -lineEnding.length) : line;
    const prefix = content.match(SSE_DATA_PREFIX);
    if (!prefix) return line;

    const payload = content.slice(prefix[0].length);
    if (!payload || payload === '[DONE]') return line;

    try {
      const event = JSON.parse(payload);
      let changed = false;
      for (const choice of event?.choices ?? []) {
        const delta = choice?.delta;
        if (delta && typeof delta.reasoning_content === 'string') {
          onReasoningContent?.();
          if (typeof delta.reasoning !== 'string') {
            delta.reasoning = delta.reasoning_content;
            changed = true;
          }
        }
      }
      return changed ? `data:${prefix[1]}${JSON.stringify(event)}${lineEnding}` : line;
    } catch {
      return line;
    }
  };

  const flushCompleteLines = (controller: TransformStreamDefaultController<Uint8Array>) => {
    let newlineAt = pending.indexOf('\n');
    while (newlineAt >= 0) {
      const line = pending.slice(0, newlineAt + 1);
      pending = pending.slice(newlineAt + 1);
      controller.enqueue(encoder.encode(normalizeLine(line)));
      newlineAt = pending.indexOf('\n');
    }
  };

  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        flushCompleteLines(controller);
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(normalizeLine(pending)));
      },
    })
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Convert the SDK's portable assistant `reasoning` field back to the exact
 * DeepSeek Chat Completions field on tool-loop continuation requests.
 */
export function prepareDeepSeekToolRequest(body: string): string {
  let request: any;
  try {
    request = JSON.parse(body);
  } catch {
    return body;
  }

  if (
    !Array.isArray(request?.messages) ||
    !Array.isArray(request?.tools) ||
    request.tools.length === 0
  ) {
    return body;
  }

  const hasReasoningHistory = request.messages.some((message: any) => {
    if (message?.role !== 'assistant') return false;
    const reasoning = message.reasoning_content ?? message.reasoning;
    return typeof reasoning === 'string' && reasoning.length > 0;
  });
  if (!hasReasoningHistory) return body;

  const messages: any[] = [];
  for (let index = 0; index < request.messages.length; index++) {
    const message = request.messages[index];
    if (message?.role !== 'assistant') {
      messages.push(message);
      continue;
    }

    // The SDK emits the text message and its function calls as consecutive
    // assistant entries. DeepSeek expects the original response to be replayed
    // as one assistant turn containing content, reasoning_content and tools.
    const assistantTurn = { ...message };
    const toolCalls = [...(assistantTurn.tool_calls ?? [])];
    let reasoning = assistantTurn.reasoning_content ?? assistantTurn.reasoning;
    delete assistantTurn.reasoning;

    while (request.messages[index + 1]?.role === 'assistant') {
      const fragment = request.messages[++index];
      const fragmentReasoning = fragment.reasoning_content ?? fragment.reasoning;
      if (reasoning === undefined) reasoning = fragmentReasoning;
      if (fragment.content !== undefined && fragment.content !== null) {
        assistantTurn.content = mergeAssistantContent(assistantTurn.content, fragment.content);
      }
      if (Array.isArray(fragment.tool_calls)) toolCalls.push(...fragment.tool_calls);
    }

    if (typeof reasoning !== 'string' || !reasoning) {
      throw new Error(
        'DeepSeek thinking 工具续轮缺少上一轮 reasoning_content，已停止发送无效请求'
      );
    }
    assistantTurn.reasoning_content = reasoning;
    if (toolCalls.length > 0) {
      assistantTurn.tool_calls = toolCalls;
      if (assistantTurn.content === null || assistantTurn.content === undefined) {
        assistantTurn.content = '';
      }
    } else {
      delete assistantTurn.tool_calls;
    }
    messages.push(assistantTurn);
  }

  request.messages = messages;
  return JSON.stringify(request);
}

function mergeAssistantContent(current: unknown, next: unknown): unknown {
  if (current === null || current === undefined) return next;
  if (typeof current === 'string' && typeof next === 'string') return current + next;
  if (Array.isArray(current) && Array.isArray(next)) return [...current, ...next];
  return current;
}
