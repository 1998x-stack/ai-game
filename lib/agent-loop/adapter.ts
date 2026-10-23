import OpenAI from 'openai';
import { buildGame } from '@/lib/build/packager';
import { runGameQuality } from '@/lib/runtime/quality-runner';
import type { AgentConfig } from '@/lib/agent/types';
import type { LoopDriver } from './engine';

function stripFence(text: string): string {
  const source = text.trim();
  const matched = source.match(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/);
  return matched ? matched[1] : source;
}

/** Role-scoped: the model has no tools and cannot write files or approve builds. */
export function createProductionLoopDriver(root: string, config: AgentConfig): LoopDriver {
  return {
    async generate(input) {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.deepseek.com',
        timeout: 12_000, maxRetries: 0,
      });
      const system = [
        'You implement a standalone HTML5 Canvas game in one scripts/game.js file.',
        'Return ONLY the complete valid JavaScript module source, no markdown or comments outside code.',
        'The project has preloaded utils.js; use GameLoop, InputManager, setupCanvas, etc.',
        'Canvas element id must remain gameCanvas.',
        'Expose window.__GAME_TEST__ = {getState:()=>({phase,score,gameOver})}.',
        'No new imports, network requests, shell commands, eval, dynamic imports or secrets.',
        'Do not claim a game passes tests; the independent test runner decides.',
      ].join('\n');
      const prompt = [
        'Goal:\n' + input.goal,
        'Versioned GDD:\n' + input.design.slice(0, 18_000),
        'Previous complete source:\n' + input.current.slice(0, 22_000),
        'Failure evidence:\n' + input.failure.slice(0, 500),
        'Attempt ' + input.attempt + '. Produce the complete revised scripts/game.js.',
      ].join('\n\n');
      const result = await client.chat.completions.create({
        model: config.model,
        messages: [{ role: 'system', content: system },
          { role: 'user', content: prompt }],
        max_tokens: 4500,
        temperature: 0.2,
      }, { signal: input.signal });
      const source = stripFence(result.choices[0]?.message?.content || '');
      if (!source || source.length > 120_000) throw new Error('Empty or oversized model source');
      const usage = result.usage?.total_tokens;
      // Providers may omit usage: conservatively estimate to avoid free retry loops.
      const tokens = usage && Number.isSafeInteger(usage) && usage > 0
        ? usage : Math.ceil((prompt.length + system.length + source.length) / 3);
      return { source, tokens };
    },
    async build() {
      const result = buildGame(root);
      return { success: result.success === true, errors: result.errors, html: result.html };
    },
    async test(html, contract) {
      const result = await runGameQuality({ workspaceRoot: root, html, contract });
      return {
        report: { status: result.report.status, runId: result.report.runId,
          contractSha256: result.report.contractSha256 },
        reportPath: result.reportPath, summary: result.text.slice(0, 400),
      };
    },
  };
}
