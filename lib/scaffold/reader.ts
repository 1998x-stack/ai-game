import fs from 'fs/promises';
import path from 'path';

interface ScaffoldDoc {
  name: string;
  content: string;
}

interface ScaffoldTemplate {
  name: string;
  gameCode: string;
  utilsCode: string;
}

const WORKSPACE_DIR = path.join(process.cwd(), 'workspace');

export async function readScaffoldDocs(): Promise<ScaffoldDoc[]> {
  const docsDir = path.join(WORKSPACE_DIR, 'docs');
  const docs: ScaffoldDoc[] = [];

  try {
    const files = await fs.readdir(docsDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const content = await fs.readFile(path.join(docsDir, file), 'utf-8');
        docs.push({ name: file.replace('.md', ''), content });
      }
    }
  } catch {
    // docs directory might not exist yet
  }

  return docs;
}

export async function getGotchas(): Promise<string> {
  try {
    return await fs.readFile(
      path.join(WORKSPACE_DIR, 'docs', 'gotchas.md'),
      'utf-8'
    );
  } catch {
    return '';
  }
}

export async function listTemplates(): Promise<string[]> {
  const templatesDir = path.join(WORKSPACE_DIR, 'templates');
  try {
    const entries = await fs.readdir(templatesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name !== 'lib')
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export async function readTemplate(templateName: string): Promise<ScaffoldTemplate | null> {
  const templateDir = path.join(WORKSPACE_DIR, 'templates', templateName);
  const libPath = path.join(WORKSPACE_DIR, 'templates', 'lib', 'utils.js');

  try {
    const gameCode = await fs.readFile(
      path.join(templateDir, 'game.js'),
      'utf-8'
    );

    let utilsCode = '';
    try {
      utilsCode = await fs.readFile(libPath, 'utf-8');
    } catch {
      // utils might not exist
    }

    return { name: templateName, gameCode, utilsCode };
  } catch {
    return null;
  }
}
