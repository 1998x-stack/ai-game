import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parseGameDesignDocument, inspectGameStateMachine } from './gdd';
import { compileGameDesign, formatGameCoverage } from './compiler';
import { listGameTemplates, loadGameTemplate } from './registry';
import { diagnoseGameQuality } from './diagnostics';
import type { QualityReport } from '@/lib/runtime/quality-evaluator';

export type GameDesignCommand =
  | { action: 'templates'; genre?: string }
  | { action: 'inspect' }
  | { action: 'compile' }
  | { action: 'diagnose'; reportId: string };

const LIMIT = 64_000;
function readJson(location: string): unknown {
  if (fs.statSync(location).size > LIMIT) throw new Error('JSON file exceeds 64 KB');
  return JSON.parse(fs.readFileSync(location, 'utf8')) as unknown;
}
function loadWorkspaceGdd(root: string) {
  return parseGameDesignDocument(readJson(path.join(root, 'game.design.json')));
}

function inspect(root: string) {
  const design = loadWorkspaceGdd(root);
  const compiled = compileGameDesign(design);
  return {
    design: { id: design.id, title: design.title, genre: design.genre,
      templateVersion: design.templateVersion },
    coverage: compiled.coverage,
    stateMachineWarnings: inspectGameStateMachine(design),
    summary: formatGameCoverage(compiled.coverage),
  };
}

/** Disallow silent overwrites of Agent or user-authored test scenarios. */
function saveContractExclusive(root: string, data: string): string {
  const file = path.join(root, 'game.test.json');
  fs.writeFileSync(file, data, { encoding: 'utf8', flag: 'wx' });
  return 'game.test.json';
}

function readQualityEvidence(root: string, reportId: string): QualityReport {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) {
    throw new Error('Invalid report ID');
  }
  const json = readJson(path.join(root, 'output', 'playtests', reportId + '.json'));
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid report');
  const report = json as QualityReport;
  if (report.schemaVersion !== 1 || report.runId !== reportId ||
      !['passed','failed','incomplete'].includes(report.status) ||
      !Array.isArray(report.scenarios) || report.scenarios.length > 8) {
    throw new Error('Unsupported or invalid quality report');
  }
  for (const scenario of report.scenarios) {
    if (typeof scenario?.id !== 'string' ||
        !['passed','failed','incomplete'].includes(scenario.status) ||
        !Array.isArray(scenario.pageErrors) ||
        !Array.isArray(scenario.checks) || scenario.checks.length > 16 ||
        scenario.checks.some(check => !check || typeof check.passed !== 'boolean' ||
          typeof check.detail !== 'string' || check.detail.length > 3000 ||
          !['canvas-size','state-equals','state-changed','game-over','no-errors']
            .includes(check.assertion?.type))) {
      throw new Error('Malformed quality evidence');
    }
  }
  return report;
}

export function executeGameDesignCommand(
  root: string,
  command: GameDesignCommand,
): string {
  switch (command.action) {
    case 'templates': {
      if (command.genre === undefined) {
        return JSON.stringify({ templates: listGameTemplates() }, null, 2);
      }
      const template = loadGameTemplate(root, command.genre);
      return JSON.stringify({ descriptor: template.descriptor,
        digest: template.digest, design: template.design }, null, 2);
    }
    case 'inspect':
      return JSON.stringify(inspect(root), null, 2);
    case 'compile': {
      const design = loadWorkspaceGdd(root);
      const compiled = compileGameDesign(design);
      if (!compiled.contract) {
        return JSON.stringify({
          status: 'not-compiled', reason: 'No automated acceptance criteria',
          coverage: compiled.coverage,
        }, null, 2);
      }
      const saved = saveContractExclusive(root, JSON.stringify(compiled.contract, null, 2) + '\n');
      return JSON.stringify({ status: 'compiled', contractPath: saved,
        coverage: compiled.coverage,
        stateMachineWarnings: inspectGameStateMachine(design) }, null, 2);
    }
    case 'diagnose': {
      const doc = loadWorkspaceGdd(root);
      const { contract, coverage } = compileGameDesign(doc);
      const report = readQualityEvidence(root, command.reportId);
      const expected = contract
        ? crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex')
        : null;
      // Prevent stale or user-edited scenarios from inheriting an unrelated
      // GDD requirement ID. Still offer independent generic diagnostics.
      const linked = expected !== null && expected === report.contractSha256;
      return JSON.stringify({
        runId: report.runId, status: report.status, linkedToCurrentDesign: linked,
        ...(linked ? {} : { warning: 'Report test contract differs from current GDD; rerun or review the original contract before attributing a requirement.' }),
        coverage, diagnostics: diagnoseGameQuality(report, linked ? coverage : undefined),
      }, null, 2);
    }
  }
}
