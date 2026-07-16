# deon-grammar

Basic editor support for `.deon` files: a [TextMate grammar](vscode-language-server/syntaxes/deon.tmLanguage.yaml) that colours the syntax, a [language configuration](vscode-language-server/language-configuration.json) for brackets and comments, and [snippets](vscode-language-server/snippets/deon.json). This is the *presentation* layer, and it is meant to stay small.

The *meaning* — the diagnostics that appear as you type, the outline, the hover, the jump to a declaration, the completion — is served by [`@plurid/deon-lsp`](../deon-lsp), a language server that reads the current `@plurid/deon` and carries no third-party dependency. That is the maintained language server, and new work belongs there.

## The language server

The extension's client (`vscode-language-server/client`) depends on [`@plurid/deon-lsp`](../deon-lsp), launches it, and connects over stdio — so VS Code gets the real diagnostics, outline, hover, go-to-declaration, and completion from the maintained server. The grammar and the server compose: one colours the text, the other gives it meaning.

The earlier bundled `server/` — a prototype written against an old `@plurid/deon` (`^0.0.0-2`) and the third-party `vscode-languageserver` runtime — has been **removed**, along with the unmodified lsp-sample end-to-end tests it shipped with. `@plurid/deon-lsp` supersedes it, and it is where the language-server work now lives and is tested.
