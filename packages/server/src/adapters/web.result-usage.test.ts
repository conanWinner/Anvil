import { describe, expect, mock, test } from 'bun:test';
import type { MessagePersistence } from './web/persistence';
import { SSETransport, type SSEWriter } from './web/transport';
import type { WorkflowEventBridge } from './web/workflow-bridge';
import { WebAdapter } from './web';

describe('WebAdapter result usage', () => {
  test('emits provider token and context metadata in session_info', async () => {
    const writeSSE = mock(async () => {});
    const stream: SSEWriter = {
      writeSSE,
      close: mock(async () => {}),
      closed: false,
    };
    const transport = new SSETransport();
    transport.registerStream('conversation-1', stream);
    const adapter = new WebAdapter(transport, {} as MessagePersistence, {} as WorkflowEventBridge);

    await adapter.sendStructuredEvent('conversation-1', {
      type: 'result',
      sessionId: 'session-1',
      tokens: { input: 12_345, output: 678 },
      contextWindow: 200_000,
      model: 'claude-sonnet-4-6',
      cost: 0.01,
    });

    expect(writeSSE).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((writeSSE.mock.calls[0]?.[0] as { data: string }).data) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      type: 'session_info',
      sessionId: 'session-1',
      tokensIn: 12_345,
      tokensOut: 678,
      contextWindow: 200_000,
      model: 'claude-sonnet-4-6',
      cost: 0.01,
    });
  });
});
