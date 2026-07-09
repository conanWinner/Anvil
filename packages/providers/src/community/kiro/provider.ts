import type {
  IAgentProvider,
  SendQueryOptions,
  MessageChunk,
  ProviderCapabilities,
} from '../../types';
import { KIRO_CAPABILITIES } from './capabilities';

/**
 * Kiro AI agent provider (Community).
 *
 * This is a boilerplate implementation.
 * You should integrate the actual Kiro SDK/API here.
 */
export class KiroProvider implements IAgentProvider {
  getType(): string {
    return 'kiro';
  }

  getCapabilities(): ProviderCapabilities {
    return KIRO_CAPABILITIES;
  }

  async *sendQuery(
    _prompt: string,
    _cwd: string,
    _resumeSessionId?: string,
    _requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    // Simulate streaming a response from Kiro
    yield { type: 'assistant', content: 'Hello! I am ' };
    yield { type: 'assistant', content: 'Kiro, your new ' };
    yield { type: 'assistant', content: 'community provider.' };

    // Example of yielding a system message
    yield { type: 'system', content: 'Kiro provider integration works!' };

    // Final result chunk
    yield {
      type: 'result',
      sessionId: 'kiro-session-123',
      tokens: { input: 10, output: 20 },
    };
  }
}
