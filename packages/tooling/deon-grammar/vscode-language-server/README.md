<p align="center">
    <a target="_blank" href="https://deon.plurid.com">
        <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    </a>
    <br />
    <br />
    <a target="_blank" href="https://github.com/plurid/deon/blob/master/LICENSE">
        <img src="https://img.shields.io/badge/license-DEL-blue.svg?colorB=1380C3&style=for-the-badge" alt="License: DEL">
    </a>
</p>



<h1 align="center">
    deon-grammar
</h1>


<h3 align="center">
    Syntax support for .deon files in Visual Studio Code
</h3>



<br />



The `Visual Studio Code` extension for `deon`. It gives a `.deon` file syntax highlighting, snippets, and live diagnostics as you type. It is editor tooling, not one of the language implementations — the language itself is defined in the [root README](../../../../README.md) and in [`spec/`](../../../../spec).

<a target="_blank" href="https://marketplace.visualstudio.com/items?itemName=plurid.deon-grammar">
    <img src="https://img.shields.io/badge/vscode-marketplace-1380C3?style=for-the-badge" alt="Marketplace">
</a>

## What it contributes

+ **Syntax highlighting** — a TextMate grammar (`source.deon`) for the `deon` language, over any `.deon` file.
+ **Snippets** — the common shapes of a document, expanded from a prefix.
+ **A language configuration** — brackets, comments, and auto-closing pairs.
+ **Diagnostics** — a language server that validates the open document and underlines what is wrong, with the same codes and positions the implementations report. The number of problems surfaced and the client/server tracing are both configurable in settings.

## Install

From the Visual Studio Code Marketplace, search for **deon**, or install [`plurid.deon-grammar`](https://marketplace.visualstudio.com/items?itemName=plurid.deon-grammar) directly.

## Building

``` bash
yarn install
yarn compile          # builds the client, the server, and the syntax
yarn package          # produces the .vsix
yarn install.local    # builds and installs the extension into the local editor
```
