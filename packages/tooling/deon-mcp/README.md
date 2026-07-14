<p align="center">
    <a target="_blank" href="https://github.com/plurid/deon">
        <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    </a>
    <br />
    <br />
    <a target="_blank" href="https://www.npmjs.com/package/@plurid/deon-mcp">
        <img src="https://img.shields.io/npm/v/@plurid/deon-mcp.svg?logo=npm&colorB=1380C3&style=for-the-badge" alt="NPM">
    </a>
</p>



<h1 align="center">
    deon-mcp
</h1>


<h3 align="center">
    Deon over the Model Context Protocol
</h3>



A [Model Context Protocol](https://modelcontextprotocol.io) server which gives a language model three things: a way to check the `deon` it writes, a way to read the `.deon` documents you have, and a way to use a `.deon` file as a prompt library.

It adds no syntax to the language. There is no `infer` keyword, no resource kind which calls a model, nothing which would make the same document parse to two different values. `deon` stays a data notation, and this is a server which speaks it.


### Contents

+ [Install](#install)
+ [Tools](#tools)
+ [Prompts](#prompts)
+ [Resources](#resources)
+ [Security](#security)



## Install

``` bash
npx @plurid/deon-mcp --root ./configurations --prompts ./prompts.deon
```

The server speaks over stdio. For `Claude Code`:

``` bash
claude mcp add deon -- npx -y @plurid/deon-mcp --root ./configurations
```

or, as a client configuration:

``` json
{
    "mcpServers": {
        "deon": {
            "command": "npx",
            "args": ["-y", "@plurid/deon-mcp", "--root", "./configurations"]
        }
    }
}
```

| flag | meaning |
| --- | --- |
| `--root <directory>` | a directory whose `.deon` files are readable; repeatable; **nothing outside a root is reachable, and the default is no roots at all** |
| `--prompts <file>` | a `.deon` file whose entities become MCP prompts |
| `--allow-network` | let a document under a root `import` over the network; off by default, and see [Security](#security) before turning it on |

Or, embedded:

``` typescript
import { createServer } from '@plurid/deon-mcp';

const server = createServer({
    roots: ['./configurations'],
    prompts: './prompts.deon',
    allowNetwork: false,
});
```



## Tools

A model writing `deon` gets it wrong, and without a server it has no way to find out. It has to guess whether the document it just produced is the document it meant. A `deon` diagnostic carries a code, a line, and a column, so the loop can actually be closed: a refusal says what is wrong and where, which is enough to fix it.

| tool | in → out |
| --- | --- |
| `deon_parse` | source → the value, or a structured diagnostic |
| `deon_lint` | source → `[{ code, severity, message, line, column }]` |
| `deon_canonical` | source → the canonical text |
| `deon_stringify` | a `JSON` value → `deon` text |
| `deon_typed` | source → the conservative typer's view |
| `deon_entities` | source → what the document declares, and what each would demand |

A failure comes back as data rather than as prose, so a model can act on it:

``` json
{
    "ok": false,
    "code": "DEON_LEX_UNTERMINATED",
    "diagnostics": [
        {
            "code": "DEON_LEX_UNTERMINATED",
            "severity": "error",
            "message": "Unterminated string.",
            "line": 2,
            "column": 9
        }
    ]
}
```

`deon_typed` is worth knowing about, because it is where a model's assumptions go to die. A `deon` value is exactly a string, a list, or a map — there are no numbers and no booleans in the data model — so `deon_parse` on `{ a 1.50 }` gives back the *string* `'1.50'`. `deon_typed` applies the conservative typer, and gives back the number `1.5`. It is conservative on purpose: `007` stays the string `'007'`, because it is not a number which could be written back out as it was read in.



## Prompts

A `.deon` file **is** a prompt library, as it stands. This needs no new syntax, and the fit is not a metaphor:

+ an MCP prompt takes named arguments, and they are strings;
+ a `deon` entity call — `#review(language Rust)` — takes named arguments, and they *must* be strings;
+ the arguments an entity demands are exactly the interpolation names it carries, and `deon` already computes that set.

So the mapping is mechanical rather than a convention which could be got wrong. The leaflinks are the templates, and the **root map is the manifest**: a key names an entity to expose, and its value describes it.

``` deon
// ./prompts.deon
review `Review this #{language} code, focusing on #{focus}:

#{code}`

explain `Explain #{topic} to #{audience}.`

{
    review  Review code for quality and bugs
    explain Explain a topic at a given level
}
```

`prompts/list` then offers `review`, described as `Review code for quality and bugs`, with the required arguments `language`, `focus`, and `code` — nothing declared them, they were read out of the template. `prompts/get` evaluates the entity call with what the client supplied, which is precisely what `#review(language Rust, focus safety, code ...)` would mean written by hand, run through the ordinary evaluator. There is not a second template engine here which could come to disagree with the first.

An entity the root does not name is not exposed. It remains a private piece of the library, exactly as a leaflink is a private piece of a document, and it is still perfectly usable *by* the exposed ones — but it has to be **linked**, not interpolated, and the difference is the whole of it:

``` deon
voice `You are terse. You do not apologize.`

review [
    { role assistant, content #voice }
    { role user, content `Review this #{language} code.` }
]

{
    review Review code for quality and bugs
}
```

`review` asks for `language`, and for nothing else. `#voice` is a **link**: the library resolves it for itself, and it never reaches the client. `#{language}` is an **interpolation**: a hole, which somebody has to fill.

That distinction is not a convention this server invented, and it does not bend. An interpolation is a parameter *even when a leaflink of the same name exists* — write `#{voice}` and `voice` becomes an argument the client must supply, and an entity call which omits it fails with `DEON_ENTITY_ARGUMENT`. Which is the correct behaviour, and the reason the argument list can be trusted: it is read out of the template by the language, and the schema the server publishes is the same set the evaluator will demand. The two cannot drift, because they are one rule.

A **conversation** needs no new syntax either — it is a list of maps, as above. An entity whose value is a string becomes a single `user` message; one whose value is a list of `{ role, content }` maps becomes that conversation. The role is `user` or `assistant`.

One thing to watch, and it is the language behaving correctly rather than a quirk of the server: a comma separates entries, so a description containing one has to be quoted. `{ review A review, of code }` is two entries — `review` and `of` — and the server will tell you it was asked to expose an entity named `of` which the library does not declare. Write `` { review `A review, of code` } ``.



## Resources

Every `.deon` file under a root is served as `deon://<path>`, in canonical form — so what a model reads is the document's meaning rather than its layout, and two servers serving the same document serve it alike.

A server given no root does not serve an empty list of resources. It does not offer the capability at all.



## Security

A `.deon` document's text becomes text a model reads, and a model acts on text it reads. That makes the capability model load-bearing here in a way it is not in an ordinary parser, and `deon` already has one: the filesystem and the network are denied unless they are asked for. Nothing about it was reinvented for this server. It was defaulted to *off*, and turned on only where an operator said so.

**A document handed to a tool came from the model.** It is not trusted, and it may reach nothing at all — no filesystem, no network, whatever the server was configured with. A document which imports gets `DEON_CAPABILITY_DENIED`, which is a diagnostic rather than a surprise:

``` deon
import secrets from /etc/passwd

{
    #secrets
}
```

**A document under a root was named by the operator**, so it may read the filesystem, which is what lets a library be composed out of imported pieces. It may not read outside the roots, and that is checked again when the file is read rather than only when it was listed — a listing says what was there, a read is what happens now.

**The network stays off.** A document which may `import` from an arbitrary URL is a way to put words a model will read into a channel nobody is watching. `--allow-network` is a decision about trust, not about convenience.

**A prompt argument is text, not source.** It is typed by whoever is driving the model, and an argument containing `#{secret}` is a user who typed some characters — it is not a link into the library's declarations. The opener is neutralized before the call is evaluated, so the argument arrives as the text it was, and cannot read a leaflink out of the library it is being passed to.



## [Codeophon](https://github.com/ly3xqhl8g9/codeophon)

+ licensing: [delicense](https://github.com/ly3xqhl8g9/delicense)
+ versioning: [αver](https://github.com/ly3xqhl8g9/alpha-versioning)
