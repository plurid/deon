#!/usr/bin/env node
// Every fenced ```deon block in the documentation must be real Deon.
//
// The failure this guards against is a documented example that no longer parses — a declaration
// written with a `#` it should not have, a `key: value` colon borrowed from JSON, a dotted key left
// unquoted. Those teach the reader something the language rejects, and nothing else in the repository
// was checking them.
//
// The rule is lenient in exactly one way: a block that parses except for having no root — a fragment
// that shows one construct, `mapName { key value }`, the way a reference page does — is allowed,
// because the docs illustrate pieces of a document and not only whole ones. A missing root is the one
// forgivable fault; a lexical error, or a parse error that is not simply the absence of a root, is a
// broken example and is named on exit.
//
// Two kinds of block are not Deon and are skipped: a syntax *template* written with <angle
// placeholders> (`import <name> from <path>`), and the informal design notes under `about/notes/`.
//
// Run it after building deon-javascript:
//   npm --prefix packages/deon-javascript run build && node scripts/doc-examples.mjs

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let Deon;
try {
    Deon = (await import(join(ROOT, 'packages/deon-javascript/distribution/index.mjs'))).default;
} catch {
    console.error('doc-examples: build deon-javascript first — npm --prefix packages/deon-javascript run build');
    process.exit(2);
}
const deon = new Deon();

const files = execSync('git ls-files "*.md"', { cwd: ROOT })
    .toString()
    .trim()
    .split('\n')
    .filter((file) => file && !file.startsWith('about/notes/'));

// A fence tagged `deon`, allowing the `` ``` deon `` spelling the docs use, non-greedy to its close.
const fence = /```[ \t]*deon\b[^\n]*\n([\s\S]*?)```/g;

// A lone lowercase word in angle brackets — `<name>`, `<path>` — is a placeholder, so the block is a
// template rather than a document. A structure signature, `<id, name>`, is not matched: its `>` does
// not follow a single word.
const isTemplate = (source) => /<[a-z]+>/.test(source);

let total = 0;
const broken = [];

for (const file of files) {
    let text;
    try {
        text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
        continue;
    }

    let match;
    while ((match = fence.exec(text)) !== null) {
        const source = match[1];
        if (isTemplate(source)) {
            continue;
        }
        total += 1;
        const line = text.slice(0, match.index).split('\n').length;
        try {
            deon.parseSyntax(source, file);
        } catch (error) {
            // A fragment with no root is allowed; every other fault is a broken example.
            if (error?.code === 'DEON_PARSE_ROOT') {
                continue;
            }
            broken.push({
                file,
                line,
                code: error?.code ?? error?.name ?? 'error',
                message: (error?.message ?? '').split('\n')[0],
            });
        }
    }
}

if (broken.length === 0) {
    console.log(`doc-examples: ${total} fenced deon blocks, every one valid Deon (a rootless fragment counts).`);
    process.exit(0);
}

console.error(`doc-examples: ${broken.length} broken example(s) out of ${total}:\n`);
for (const one of broken) {
    console.error(`  ${one.file}:${one.line}  ${one.code} — ${one.message}`);
}
process.exit(1);
