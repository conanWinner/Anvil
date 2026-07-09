import { describe, test, expect } from 'bun:test';
import { buildAnvilMcpServer, ANVIL_TOOL_SERVER } from './native-tools';
import type { NativeTool } from '../types';

function spec(inputSchema: Record<string, unknown>): NativeTool {
  return {
    name: 'manage_run',
    description: 'test tool',
    inputSchema,
    handler: () => Promise.resolve('ok'),
  };
}

const VALID_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'get'], description: 'the action' },
    runId: { type: 'string' },
    confirm: { type: 'boolean', description: 'guard' },
  },
  required: ['action'],
};

describe('buildAnvilMcpServer (Claude JSON-Schema → Zod)', () => {
  test('builds for a valid schema with string / string-enum / boolean fields', () => {
    const server = buildAnvilMcpServer([spec(VALID_SCHEMA)]);
    expect(server).toBeDefined();
    expect(ANVIL_TOOL_SERVER).toBe('anvil');
  });

  test('rejects a non-object schema (fail-fast)', () => {
    expect(() => buildAnvilMcpServer([spec({ type: 'string' })])).toThrow(
      /must be an object schema/
    );
  });

  test('rejects an unsupported field type (number)', () => {
    expect(() =>
      buildAnvilMcpServer([
        spec({ type: 'object', properties: { n: { type: 'number' } }, required: [] }),
      ])
    ).toThrow(/unsupported type/);
  });

  test('rejects an empty enum', () => {
    expect(() =>
      buildAnvilMcpServer([
        spec({ type: 'object', properties: { a: { enum: [] } }, required: ['a'] }),
      ])
    ).toThrow(/non-empty strings/);
  });
});
