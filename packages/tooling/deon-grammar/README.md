# deon-grammar

Basic editor support for `.deon` files: a [TextMate grammar](vscode-language-server/syntaxes/deon.tmLanguage.yaml) that colours the syntax, a [language configuration](vscode-language-server/language-configuration.json) for brackets and comments, and [snippets](vscode-language-server/snippets/deon.json). This is the *presentation* layer, and it is meant to stay small.

The *meaning* — the diagnostics that appear as you type, the outline, the hover, the jump to a declaration, the completion — is served by [`@plurid/deon-lsp`](../deon-lsp), a language server that reads the current `@plurid/deon` and carries no third-party dependency. That is the maintained language server, and new work belongs there.

## The `vscode-language-server` prototype is retired

The `vscode-language-server/server` (and its `client`) here is an earlier language-server prototype, written against an old `@plurid/deon` (`^0.0.0-2`) and the third-party `vscode-languageserver` runtime. Its semantics are **superseded by `@plurid/deon-lsp`** and it is no longer maintained. It is kept only so the VS Code extension packaging around the TextMate grammar is not disturbed; do not build on it.

To give VS Code the real diagnostics, point the extension's client at `node …/deon-lsp/distribution/cli.js` rather than at the bundled server, and the grammar and the server compose — one colours the text, the other gives it meaning.
