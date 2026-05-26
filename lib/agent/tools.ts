import { ToolDefinition } from './types';

/**
 * Tool definitions for the agent — each tool has the inner function shape
 * matching OpenAI's function-calling format.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file within the user space. Returns the full file content as a string.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path to the file (must be within workspace root)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file within the user space. Creates parent directories if they do not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path to the file (must be within workspace root)',
        },
        content: {
          type: 'string',
          description: 'Full content to write to the file',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description: 'Replace text in a file within the user space. Finds the first occurrence of old_str and replaces it with new_str.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path to the file (must be within workspace root)',
        },
        old_str: {
          type: 'string',
          description: 'The exact text to search for (first occurrence is replaced)',
        },
        new_str: {
          type: 'string',
          description: 'The replacement text',
        },
      },
      required: ['path', 'old_str', 'new_str'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at the given path within the user space.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute path to the directory (must be within workspace root)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'build_game',
    description: 'Run the build command to package scripts and assets into a single HTML file. No parameters needed.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'set_error',
    description: 'Report an error to the user when the agent encounters an unrecoverable issue. Call this when you cannot recover from a problem.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The error message describing what went wrong',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
];

/**
 * Returns the tool definitions wrapped in the OpenAI-compatible format
 * expected by the chat completions API.
 */
export function getOpenAITools(): { type: 'function'; function: ToolDefinition }[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: tool,
  }));
}
