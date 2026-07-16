<p align="center">
    <a target="_blank" href="https://github.com/plurid/deon">
        <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    </a>
    <br />
    <br />
    <a target="_blank" href="https://www.npmjs.com/package/@plurid/deon-lsp">
        <img src="https://img.shields.io/npm/v/@plurid/deon-lsp.svg?logo=npm&colorB=1380C3&style=for-the-badge" alt="NPM">
    </a>
</p>



<h1 align="center">
    deon-lsp
</h1>


<h3 align="center">
    A Deon language server
</h3>



A [Language Server Protocol](https://microsoft.github.io/language-server-protocol) server for `.deon` documents: the red underline that appears as you type, the outline of what a document declares, the hover that says what a name is, the jump to where it was declared, and the completion of a declared name.

It reads the same `@plurid/deon` the command-line tool does, so a fault an editor shows is a fault the tool would report, at the same place. And it carries **no third-party dependency** — the protocol wire is spoken directly, the way the seven Deon cores speak their own. Nothing is installed to run it but Node.


### Contents

- [Install](#install)
- [Features](#features)
- [How it works](#how-it-works)
- [Editor setup](#editor-setup)


## Install

```bash
npm install
npm run build
```

The server runs over standard input and output, which is how an editor launches one:

```bash
node distribution/cli.js
```

There is nothing else to configure. The server watches no files, reads no configuration, and — deliberately — reaches no disk and opens no socket (see [How it works](#how-it-works)).


## Features

The server answers over the protocol; an editor turns each answer into what you see.

| Capability | What you get |
| --- | --- |
| `publishDiagnostics` | The one lex-or-parse fault that stops a document, and every lint warning it earns — a duplicate map key among them — underlined at the exact character. |
| `documentSymbol` | An outline: every leaflink, import, and inject the document declares, then the root's keys nested as deeply as they go. |
| `hover` | What the name under the cursor is: the leaflink, the import and where it reads from, the entity and the arguments it would demand. |
| `definition` | A jump from a `#reference` to the declaration it names. |
| `completion` | The names a `#` may reach, offered from the last syntax tree that parsed — so a name still completes while the line being typed does not yet. |

A diagnostic is never invented. Its code, its severity, and its position are exactly what `@plurid/deon` reports, which is exactly what `spec/diagnostics.md` requires of every implementation; the server only carries them to the editor.


## How it works

**No interpretation.** The server scans and parses; it does not evaluate. An `import ./secret.deon` in a buffer is *described*, never *fetched* — so the server needs no filesystem or network capability, cannot be made to read a file by the document it is shown, and cannot hang on a network read. Faults that only appear when a document is evaluated — an unresolved link, a dependency cycle — belong to the command-line tool, which is where a document is actually run.

**One position adapter.** Deon measures a position in code points (the `😀` a reader sees is one); the protocol measures it in UTF-16 code units (that same `😀` is two, a surrogate pair). The adapter converts between them in both directions, so an underline lands on the character meant and a click resolves the token beneath it. It is the load-bearing piece, and it is tested against exactly the case where the two disagree.

**Full-text sync.** The editor sends the whole document on every change. It is the simplest thing that is always correct, and a Deon document is small.


## Editor setup

Any editor that speaks LSP can drive this server; point its client at `node …/distribution/cli.js` for the `deon` language. Basic syntax highlighting — a TextMate grammar and a language configuration — lives beside it in [`deon-grammar`](../deon-grammar); the two compose, the grammar coloring the text and this server giving it meaning.


## [Codeophon](https://github.com/ly3xqhl8g9/codeophon)

  + [license](https://github.com/ly3xqhl8g9/codeophon/blob/master/license)
