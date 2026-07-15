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



The `Visual Studio Code` extension for `deon`. It gives a `.deon` file syntax highlighting, snippets, and editor configuration, and bundles a language-server client and server that are a work in progress. It is editor tooling, not one of the language implementations — the language itself is defined in the [root README](../../../../README.md) and in [`spec/`](../../../../spec).

<a target="_blank" href="https://marketplace.visualstudio.com/items?itemName=plurid.deon-grammar">
    <img src="https://img.shields.io/badge/vscode-marketplace-1380C3?style=for-the-badge" alt="Marketplace">
</a>

## What it contributes

+ **Syntax highlighting** — a TextMate grammar (`source.deon`) for the `deon` language, over any `.deon` file.
+ **Snippets** — the common shapes of a document, expanded from a prefix.
+ **A language configuration** — brackets, comments, and auto-closing pairs.

The extension also bundles a language-server client and server, but that half is **not finished**: the diagnostics it emits are still the scaffold's placeholder checks rather than real `deon` validation, and hover, go-to-definition, and completion are stubs (see [`notes/general.md`](./notes/general.md) for the open items). The syntax highlighting, snippets, and configuration are the parts that work today.

## Install

From the Visual Studio Code Marketplace, search for **deon**, or install [`plurid.deon-grammar`](https://marketplace.visualstudio.com/items?itemName=plurid.deon-grammar) directly.

## Building

``` bash
yarn install
yarn compile          # builds the client, the server, and the syntax
yarn package          # produces the .vsix
yarn install.local    # builds and installs the extension into the local editor
```
