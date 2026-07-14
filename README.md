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
    deon
</h1>


<h3 align="center">
    DeObject Notation Format
</h3>



<br />



`deon` is a notation format for structured data.

`deon` is intended to be:

+ light on syntax — friendly for human read/write, should feel more like note-taking than data entry;
+ moderately fast — with a general use case for configuration-like files, loaded once at build/runtime;
+ programming-lite — although not a programming language, the in-file imports and the linking (in-file variables) give `deon` a programmatic feel.

The `deon` filename extension is `.deon`, and the media type is `application/deon`.

Why `deobject`? More of a play-on-words, although a case can be made considering the [linking](#linking) feature and the possible 'assembling' of the `root`, as if the object has been de-structured. As an afterthought, `deon` could also be rooted into the Ancient Greek word, [δέον](https://en.wiktionary.org/wiki/%CE%B4%CE%AD%CE%BF%CE%BD), that which is binding, such as how data binds functionality into code.


### Contents

+ [Example](#example)
+ [Implementations](#implementations)
+ [Installs](#installs)
+ [Service](#service)
+ [General](#general)
+ [Values](#values)
+ [Maps](#maps)
+ [Lists](#lists)
+ [Structures](#structures)
+ [Comments](#comments)
+ [Linking](#linking)
+ [Importing](#importing)
+ [Injecting](#injecting)
+ [Interpolation](#interpolation)
+ [Stringifying](#stringifying)
+ [Parsing](#parsing)
+ [Literals](#literals)
+ [Advanced Usage](#advanced-usage)
+ [Deon for AI](#deon-for-ai)
+ [In Use](#in-use)
+ [Usages](#usages)
+ [Idiomaticity](#idiomaticity)
+ [Specifics](#specifics)
+ [Packages](#packages)
+ [Codeophon](#codeophon)



## Example

The following `.deon` file

``` deon
// deon

{
    entities [
        {
            id 01
            name One
            active true
        }
        {
            id 02
            name Two
            active false
        }
    ]
    #time
}

time 1598439736
```

will produce the following data

``` typescript
// JavaScript/TypeScript

const data = {
    entities: [
        {
            id: '01',
            name: 'One',
            active: 'true',
        },
        {
            id: '02',
            name: 'Two',
            active: 'false',
        },
    ],
    time: '1598439736',
};
```

``` rust
// Rust

let data = deon!({
    entities [
        {
            id 01
            name One
            active true
        }
        {
            id 02
            name Two
            active false
        }
    ]
    time: 1598439736
});
```

``` python
# Python

data = {
    "entities": [
        {
            "id": "01",
            "name": "One",
            "active": "true",
        },
        {
            "id": "02",
            "name": "Two",
            "active": "false",
        },
    ],
    "time": "1598439736",
}
```


### Comparisons

Consider the following commonly-used formats with an example file from [`performer`](https://github.com/plurid/performer):


``` yaml
# an .yaml file

---
stages:
- name: 'Setup NPM Private Access'
  directory: '/path/to/package'
  imagene: 'ubuntu'
  command:
  - '/bin/bash'
  - './configurations/.npmrc.sh'
  secretsEnvironment:
  - 'NPM_TOKEN'

- name: 'Generate the Imagene'
  directory: '/path/to/package'
  imagene: 'docker'
  command: [
    'build',
    '-f',
    './configurations/docker.development.dockerfile',
    '-t',
    'hypod.cloud/package-name:$SHORT_SHA',
    '.'
  ]

- name: 'Push Imagene to Registry'
  directory: '/path/to/package'
  imagene: 'docker'
  command: [
    'push',
    'hypod.cloud/package-name:$SHORT_SHA'
  ]

timeout: 720
```

``` json
// a .json file

{
  "stages": [
    {
      "name": "Setup NPM Private Access",
      "directory": "/path/to/package",
      "imagene": "ubuntu",
      "command": [
        "/bin/bash",
        "./configurations/.npmrc.sh"
      ],
      "secretsEnvironment": [
        "NPM_TOKEN"
      ]
    },
    {
      "name": "Generate the Imagene",
      "directory": "/path/to/package",
      "imagene": "docker",
      "command": [
        "build",
        "-f",
        "./configurations/docker.development.dockerfile",
        "-t",
        "hypod.cloud/package-name:$SHORT_SHA",
        "."
      ]
    },
    {
      "name": "Push Imagene to Registry",
      "directory": "/path/to/package",
      "imagene": "docker",
      "command": [
        "push",
        "hypod.cloud/package-name:$SHORT_SHA"
      ]
    }
  ],
  "timeout": 720
}
```

Consider the `.deon` version:

``` deon
// a .deon file

{
    stages [
        {
            name Setup NPM Private Access
            directory /path/to/package
            imagene ubuntu
            command [
                /bin/bash
                ./configurations/.npmrc.sh
            ]
            secretsEnvironment [
                NPM_TOKEN
            ]
        }
        {
            name Generate the Imagene
            directory /path/to/package
            imagene docker
            command [
                build
                -f
                ./configurations/docker.development.dockerfile
                -t
                hypod.cloud/package-name:$SHORT_SHA
                .
            ]
        }
        {
            name Push Imagene to Registry
            directory /path/to/package
            imagene docker
            command [
                push
                hypod.cloud/package-name:$SHORT_SHA
            ]
        }
    ]
    timeout 720
}
```


or with nested internal linking


``` deon
// a .deon file

// the root
{
    stages [
        #stage1
        #stage2
        #stage3
    ]
    timeout 720
}


// the leaflinks
stage1 {
    name Setup NPM Private Access
    #directory
    imagene ubuntu
    command #commands.stage1
    #secretsEnvironment
}

stage2 {
    name Generate the Imagene
    #directory
    imagene docker
    command #commands.stage2
}

stage3 {
    name Push Imagene to Registry
    #directory
    imagene docker
    command #commands.stage3
}

directory /path/to/package

commands {
    stage1 [
        /bin/bash
        ./configurations/.npmrc.sh
    ]
    stage2 [
        build
        -f
        ./configurations/docker.development.dockerfile
        -t
        #imageneName
        .
    ]
    stage3 [
        push
        #imageneName
    ]
}

secretsEnvironment [
    NPM_TOKEN
]

imageneName hypod.cloud/package-name:$SHORT_SHA
```



## Implementations

`deon` is implemented for:

+ [`JavaScript/TypeScript`](https://github.com/plurid/deon/tree/master/packages/deon-javascript)
+ [`Rust`](https://github.com/plurid/deon/tree/master/packages/deon-rust)
+ [`Python`](https://github.com/plurid/deon/tree/master/packages/deon-python)

and will be implemented for:

+ [`C`](https://github.com/plurid/deon/tree/master/packages/deon-c)
+ [`C++`](https://github.com/plurid/deon/tree/master/packages/deon-cpp)
+ [`denatural`](https://github.com/plurid/deon/tree/master/packages/deon-denatural)
+ [`Go`](https://github.com/plurid/deon/tree/master/packages/deon-go)
+ [`Java`](https://github.com/plurid/deon/tree/master/packages/deon-java)
+ [`PHP`](https://github.com/plurid/deon/tree/master/packages/deon-php)
+ [`Swift`](https://github.com/plurid/deon/tree/master/packages/deon-swift)

See [specifics](#specifics) for implementation details.


## Installs

`deon` can be installed locally with the appropriate package manager for each implementation language, or can be installed globally as a `Command-Line Interface` tool.

Using the `NodeJS` runtime, run the command

``` bash
npm install -g @plurid/deon
```

or download the appropriate [binary](https://plurid.link/binaries-deon)

+ [MacOS](https://files.plurid.com/binaries/deon/macos)
+ [Linux](https://files.plurid.com/binaries/deon/linux)
+ [Windows](https://files.plurid.com/binaries/deon/windows)


### CLI

```
Usage: deon [options] [command] <file>

read a ".deon" file and output the parsed result

Options:
    -v, --version                                   output the version number
    -o, --output <value>                            output type: deon, json (default: "deon")
    -t, --typed <value>                             typed output (default: "false")
    -f, --filesystem <value>                        allow filesystem (default: "true")
    -n, --network <value>                           allow network (default: "false")
    -h, --help                                      display help for command

Commands:
    convert <source> [destination]                  convert a ".json" file to ".deon"
    environment [options] <source> <command...>     loads environment variables from a ".deon" file and spawns a new command
    confile [options] <files...>                    combine files into a single ".deon" file
    exfile <source>                                 extract files from a ".deon" confile
    lint <files...> [--warnings-as-errors]          report the diagnostics of a ".deon" file
```

Network access is off unless it is asked for. A `.deon` file is data, and reading it should not by itself reach out over the network, so `import`s and `inject`s from an `URL` require `--network true`.



## Service

The `deon` data parsing can be explored on [`deon.plurid.com`](https://deon.plurid.com) and `deon.plurid.com/parse` can be used for programmatic `POST` requests.

``` bash
curl \
    -X POST \
    -H 'Content-Type: application/deon' \
    -d '{ key value }' \
    https://deon.plurid.com/parse
```

The response is `deon` by default, but can be specified through the `kind` query parameter (`json`, `yaml`, `toml`, or `xml`).

``` bash
curl \
    -X POST \
    -H 'Content-Type: application/deon' \
    -d '{ key value }' \
    https://deon.plurid.com/parse?kind=yaml
```

Conversely, `json`, `yaml`, `toml`, or `xml` data can be converted to `deon` through a `deon.plurid.com/convert` `POST` request

``` bash
curl \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{ "key": "value" }' \
    https://deon.plurid.com/convert
```

The [`deon.plurid.com`](https://deon.plurid.com) service can also host `.deon` files to be easily `import`ed or `inject`ed into other files from a fixed `URL` allowing control over the private/public status, the file's revision, or access-aware content (the content of the file changes based on who/what token requests it).



## General

A `deon` is comprised of a required `root` and none or more, optional `leaflink`s.

In `deon` every endleaf value is a `string`. It is up to the consumer to handle the required type conversions based on the problem domain interface. An [advanced use case](#advanced-usage) couples `deon` with [`datasign`](https://github.com/plurid/datasign) to handle type conversions.

`deon` supports two types of [`value`](#values) groupings, the [`map`](#maps) and the [`list`](#lists).

The `root` can be `map` or `list`-like.

The `leaflink`s can be `string`s, `map`s, or `list`s.

The `map`s and the `list`s can have `string`s, `list`s, and `map`s as values,

The order of the `root` or of any of the `leaflink`s is not important.

The per `map` `key` names and the `leaflink`s names are expected to be unique.

When parsed or imported, a `.deon` file will allow access only to the `root`. The `leaflink`s are private as data-details at the file level. By convention, a `__leaflinks__` key can be manually added to the `root` to allow access to the `leaflink`s if absolutely needed.

Tooling that needs to see the `leaflink`s themselves — an editor offering completions, say — can ask for them directly, without them leaking into the parsed data:

``` typescript
await deon.leaflinks(`
{
    #a
}

a one
b two
`);
// { a: 'one', b: 'two' }
```



## Values

An endleaf `value`, simply called `value`, is a string of characters, with or without spaces:

``` deon
{
    key simpleValue
}
```

``` deon
{
    key value with spaces
}
```


A `value` can be surrounded by singlequotes `'` in order to support special characters, such as trailing spaces

``` deon
{
    key 'value with 4 trailing spaces    '
}
```


Multi-line `value`s are surrounded by backticks <code>`</code>. The multi-line string is stripped of any whitespace or new lines before the first non-space character and after the last non-space character.


``` deon
{
    key `
a
multi
line
string
value
        `
}
```

or linked

``` deon
{
    #key
}

key `
a
multi
line
string
value
`
```


### Escapes

The same escapes are read in all three forms of `value`:

| escape | character |
| --- | --- |
| `\\` | a single backslash |
| `\'` | a singlequote, inside a singlequoted `value` |
| `` \` `` | a backtick, inside a backticked `value` |
| `\#{` | the literal characters `#{` |
| `\n` `\r` `\t` | a newline, a carriage return, a tab |

Any other backslash is kept as it is written.

The `\n` escape is what lets a `value` end in a newline. A backticked `value` strips the whitespace around its text, which is what makes it pleasant to indent in a file, but it also means the backticks alone cannot say "this text ends with a newline". The escape can:

``` deon
{
    // 'alpha' followed by a newline
    file 'alpha\n'

    // 'a', newline, 'b' — the indentation is layout, and is stripped
    text `
        a
        b
    `
}
```

Because of this, every `value` can be written down, and `stringify` and `parse` are exact inverses of each other.



## Maps

``` deon
mapName {
    mapKey mapValue
}
```

A `map` is comprised of key-value pairs. The `deon` `root` is the single base-level `map` without a `mapName`.

A `mapKey` is an `A-Za-z0-9_-` string of characters. To support special characters (such as space), the `mapKey` must be surrounded by single quotes, such as

``` deon
mapName {
    'map Key' mapValue
}
```

A `mapValue` starts after the space of the `mapKey` and continues until the end of the line or until a comma.


``` deon
mapName {
    mapKey1 map Value 1
    mapKey2 mapValue2
}
```

or

``` deon
mapName {
    mapKey1 map Value 1, mapKey2 mapValue2
}
```

A `mapValue` can be a `string`, a `list`, or a `map`.

A `mapValue` can be an empty `string`:

``` deon
mapName {
    mapKey1
    mapKey2 mapValue2
}
```

or

``` deon
mapName {
    mapKey1 '', mapKey2 mapValue2
}
```



## Lists

``` deon
listName [
    list Value 1
    listValue2
]
```

A `list` is comprised of a `listName` and the list items. The `deon` `root` is the single base-level `list` without a `listName`.

A `list` item value starts at the first non-space character after the left square bracket `[`, or after the previous list item, and ends at the end of the line or at the comma.

Such as

``` deon
listName [
    list Value 1, listValue2
]
```

or

``` deon
listName [list Value 1, listValue2]
```

Each list item can be a `string`, a `list`, or a `map`.

A list item can be an empty `string`:

``` deon
listName [
    ''
    listValue2
]
```

or

``` deon
listName [
    '', listValue2
]
```


## Structures

A `structure` is used to specify structured data

```
{
    aStructure <
        // structure signature
        id, value
    > [
        // first data entry
        one, two
        // second data entry
        three, four
        // third data entry
        five, six
    ]
}
```


## Comments

Single-line comments use the doubleslash `//`.

``` deon
// comment outside root
{
    // comment inside root
    key value // comment in-line
}
```

Multi-line comments use the slashstar `/*` to start, and the starslash to end `*/`.

``` deon
/*
    multi
    line
    comment outside root
*/
{
    /*
        multi
        line
        comment inside root
    */
    key value
}
```



## Linking

### General

A `leaflink` is designated using the hash sign `#`.

The `.deon` file

``` deon
{
    key value
}
```

can be linked thus

``` deon
{
    key #arbitraryName
}

arbitraryName value
```

or with shortened linking

``` deon
{
    #key
}

key value
```

To support linking with special characters in name, the `leaflink` must be surrounded by singlequotes `'`.


``` deon
{
    #'key with spaces'
}

'key with spaces' value
```


### Dot-access

A `leaflink` can be dot-accessed:

``` deon
{
    entities [
        {
            name #entity1.name
        }
    ]
}

#entity1 {
    name The Entity
}
```

or dot-accessed with shortened link

``` deon
{
    entities [
        {
            #entity1.name
        }
    ]
}

#entity1 {
    name The Entity
}
```

in which case, the `key` will be the last key of the dot-access string.


### Name-access

A `leaflink` can be name-accessed:

``` deon
{
    entities [
        {
            name #entity1[name]
        }
    ]
}

#entity1 {
    name The Entity
}
```

or from a `list`:

``` deon
{
    entities [
        {
            name #names[0]
        }
    ]
}

#names [
    one
    two
    three
]
```

The `list` has a zero-based indexation.


### Spreading

A `leaflink` can be spreaded by tripledots `...`:

``` deon
{
    entities [
        {
            ...#entity1
        }
    ]
}

#entity1 {
    name The Entity
    timestamp 1598425060
}
```

Spreading overwrites the previously defined keys, if any, with the same name as the keys in the spreaded `map`.

A `map` can be spreaded only in another `map`. A `list` can be spreaded only in another `list`. A `string` can be spreaded in a `map` and will result in a `map` where each key equals the index of the character of the `string`, or can be spreaded into a `list` and will result in a `list` where each list item is a character of the `string`.

``` deon
{
    entity {
        ...#spread
    }
}

spread abc
```

wil result in `entity` having the `value`:

``` deon
entity {
    0 a
    1 b
    2 c
}
```

whereas

``` deon
{
    entity [
        ...#spread
    ]
}

spread abc
```

wil result in `entity` having the `value`:

``` deon
entity [
    a
    b
    c
]
```


### Environment variables

A `leaflink` can represent an environment variable using the `#$` syntax. The environment variable will be injected at parse-time:

``` deon
{
    one #$SOME_ENV_VARIABLE
}

two #$ANOTHER_ENV_VARIABLE
```



## Importing

A `.deon` file can import another `.deon` file using the following syntax

``` deon
import <name> from <path>
```

Where the `name` is an arbitrary string, and the `path` is the path of the targeted `.deon` file.

The `path` does not need to have the `.deon` filename extension specified.

The `path` can also point to a `.json` file, and `deon` will parse it appropriately.

The import imports the `root` from the targeted `.deon` file in order to be used as a regular, in-file locally-defined `leaflink`.

The import statement order in file is not important, although, by convention, they sit at the top of file. Imports will be resolved primarily, before any other action. The import `name` must be unique among all the other imports and among the in-file locally-defined `leaflink`s, given that there is no discernible conceptual difference between them.


``` deon
// file-1.deon

{
    name The Name
}
```


``` deon
// file-2.deon

import file1 from ./file-1

{
    name #file1.name
}
```

The `path`s of the imported files can be relative filesystem paths, and they will be automatically searched and imported if found, or absolute filesystem paths, if all the used absolute paths are passed to the parser at parse-time.

``` deon
// file-2.deon

import file1 from absolute/path/file-1

{
    name #file1.name
}
```

and parsed giving the absolute paths, specific to a file or general using the `/*` glob-like matcher:

``` typescript
// TypeScript example

import Deon from '@plurid/deon';


const deonFilePath = '/absolute/path/to/folder/file-1.deon';
const deonFilesPath = '/absolute/path/to/folder/';

const loadData = async () => {
    const absolutePaths = {
        // specific file
        'absolute/path/file-1': deonFilePath,
        // or file lookup at runtime
        'absolute/path/*': deonFilesPath,
    };

    const deon = new Deon();
    const data = await deon.parseFile(
        '/path/to/file-1.deon',
        {
            absolutePaths,
        },
    );

    return data;
}

const main = async () => {
    const data = await loadData();

    // use data
    console.log(data);
    // { name: 'The Name' };
}

main();
```


A `path` can also be an `URL` such as

``` deon
// file-url.deon

import urlFile from https://example.com/url-file.deon

{
    #urlFile.key
}
```

In order to request `URL` files from protected routes, an `authorization` `map` of authorization `token`s can be passed at parse-time with all the domains required by the imports

``` deon
authorization {
    example.com token
}
```

with the `token` being automatically passed into the `Authorization: Bearer <token>` header of the adequate domain at request-time.

``` typescript
// TypeScript example

import Deon from '@plurid/deon';


const loadData = async () => {
    const authorization = [
        'example.com': 'token', // provide token securely using environment variables
    ];

    const deon = new Deon();
    const data = await deon.parseFile(
        '/path/to/file-url.deon',
        {
            authorization,
        },
    );

    return data;
}

const main = async () => {
    const data = await loadData();

    // use data
    console.log(data);
    // { key: 'data from url file' };
}

main();
```

The token can be passed at import-time in the `.deon` file:

``` deon
import urlFile from https://example.com/url-file.deon with secret-token

{
    #urlFile.key
}
```

In order not to leak secrets, environment variables should be used:

``` deon
import urlFile from https://example.com/url-file.deon with #$SECRET_TOKEN

{
    #urlFile.key
}
```



## Injecting

The `import` statement will always try to parse the filetext into structured data.

In order to get only the filetext, the keyword `inject` can be used:

``` deon
inject leaflinkName from /path/to/file.any

{
    key #leaflinkName
}
```

The arbitrarily-named `inject` entity can be used as a regular `leaflink` containing a `string`.

Similar to the `import` statement, the `inject` can target an URL and pass an optional authentication token.

``` deon
inject file from https://example.com/file
inject secretFile from https://example.com/secret-file with secret-token

{
    key1 #file
    key2 #secretFile
}
```

In order to keep the `.deon` file secret-free, the secrets can be injected from a file outside or ignored by the versioning system.


``` deon
inject secret from file-with-secret.text
inject secretFile from https://example.com/secret-file with #secret

{
    key #secretFile
}
```



## Interpolation

A `string` value can be interpolated in another `string` using the `#{}` syntax.

``` deon
{
    key value1 #{value2Key} value3
    list [
        value1 #{value2Key}
        value3
    ]
}

value2Key value2-text
```

which will produce the result

``` deon
{
    key value1 value2-text text3
    list [
        value1 value2-text
        value3
    ]
}
```


A `deon` entity, `map`, `list`, `string`, can be "called" to provision the interpolation values dynamically, on a use-case basis.

``` deon
aKey {
    subKey value1 #{value2} value3
}

{
    key1 #aKey(
        value2 value2-text
    )
    key2 #aKey(
        value2 value2-different-text
    )
}
```



## Stringifying

A `stringify` method is implemented in order to convert an in-memory data representation to string. A partial `options` object can be passed.

``` typescript
interface DeonStringifyOptions {
    // one line per entry, or the whole value on a single line (default: true)
    readable: boolean;
    indentation: number;
    // extract the maps and lists at `leaflinkLevel` into leaflinks after the root
    leaflinks: boolean;
    leaflinkLevel: number;
    // write `#name` when the receiving key is the name of the leaflink
    leaflinkShortening: boolean;
    generatedHeader: boolean;
    generatedComments: boolean;
    // sorted, inlined, comment-free — see below
    canonical: boolean;
}
```

With `readable: false` the value is written on one line, the entries separated by the comma that `deon` accepts wherever it accepts a newline:

``` deon
{a b, c [d, e], f {g h}}
```


### Canonical

A `canonical` method writes the one form of a value that every implementation agrees on: the maps sorted by code point, the lists left in their order, four spaces, no comments, no leaflinks, and a single closing newline.

``` typescript
const deon = new Deon();

deon.canonical('{ z last\na first }');
// '{\n    a first\n    z last\n}\n'
```

For every value, `parse(canonical(value))` returns that same value.



## Parsing

The `parse` method can receive the following partial options:

``` typescript
interface DeonParseOptions {
    absolutePaths: Record<string, string>,
    authorization: Record<string, string>,

    datasignFiles: string[];
    datasignMap: Record<string, string>;
    // read a datasign contract with something other than the built-in reader
    datasignReader?: (source: string) => DatasignSignatures;

    // capabilities, both off unless asked for — a raw-text parse reaches nowhere
    allowFilesystem: boolean;
    allowNetwork: boolean;

    // resolve `import`s and `inject`s from these, instead of the filesystem or the network
    resources: Record<string, string>;

    // read by `#$NAME`, in preference to the process environment
    environment: Record<string, string>;

    // the name the document is known by, and what its relative targets resolve against;
    // both are set for you by `parseFile`, and are what a diagnostic points at
    sourceName: string;
    filebase: string;

    // sent as `Authorization: Bearer <token>`, and part of the cache key
    token: string;

    cache: boolean;
    cacheDuration: number;
    cacheDirectory: string;

    // threaded through nested imports to catch a resource cycle; set by the evaluator, not by you
    resourceStack: string[];
}
```

`parseFile` turns on `allowFilesystem`, since it was handed a file to begin with. `parse` is given text and reaches nowhere on its own.

The `resources` map resolves an `import` or an `inject` from memory, keyed by its target. It is how a test exercises importing without touching the filesystem or the network:

``` typescript
const data = await deon.parse(
    `import config from https://example.com/config.deon\n{ #config.key }`,
    {
        resources: {
            'https://example.com/config.deon': '{ key value }',
        },
    },
);
// { key: 'value' }
```


### Diagnostics

A failed `parse` throws a `DeonError`, which carries every diagnostic it could collect. Each one has a stable code, a severity, the source it came from, and a position.

``` typescript
try {
    await deon.parse('{ key #missing }');
} catch (error) {
    // 'DEON_UNRESOLVED_LINK'
    console.log(error.code);
    // '<memory>:1:7 error DEON_UNRESOLVED_LINK Unknown leaflink 'missing'.'
    console.log(error.diagnostics[0]);
}
```

A `lint` method returns the diagnostics without throwing, which is what the `deon lint` command reports.

``` typescript
deon.lint('{ key first\nkey second }');
// [ DEON_LINT_DUPLICATE_KEY: Map key 'key' is written more than once. ]
```



## Literals

To handle `deon` data inside the implementation language, a language-specific literal can be used.


### `Javascript`/`Typescript`

``` typescript
import {
    deon,
} from '@plurid/deon';


const main = async () => {
    const data = await deon`
        // handles full-fledged deon data
        // with imports, injects, leaflinks, etc.
        {
            key value
        }
    `;

    // { key: 'value' }
    console.log(data);
}


main();
```


### Rust

``` rust
use deon::{deon}


fn main() {
    let data = deon!(
        // handles full-fledged deon data
        // with imports, injects, leaflinks, etc.
        {
            key value
        }
    );

    // { key: 'value' }
    println!("{}", data.to_string());
}
```



## Advanced Usage

### Datasign Type Conversion

When handling the parsing of `.deon` data, a `.datasign` file can be passed to handle the type conversions.

For example, given a `JavaScript/TypeScript` use case:

``` datasign
// ./Entity.datasign
data Entity {
    name: string;
    age: number;
}
```


``` deon
// ./entity.deon
{
    entities: [
        {
            name Entity One
            age 1
        }
        {
            name Entity Two
            age 1.3
        }
    ]
}
```


``` typescript
// ./index.ts
import Deon from '@plurid/deon';


const deonFile = './entity.deon';
const datasignFile = './Entity.datasign';

const deon = new Deon();

const data = await deon.parseFile(
    deonFile,
    {
        // pass an array of all the .datasign files to be considered for type handling
        // (relative paths resolve against the `.deon` file)
        datasignFiles: [
            datasignFile,
        ],
        // pass an object of the mappings between the fields from the .deon file
        // and the expected types from the .datasign file
        datasignMap: {
            entities: 'Entity[]',
        },
    },
);

// {
//     entities: [
//         { name: 'Entity One', age: 1 },    // `age` is a number, not a string
//         { name: 'Entity Two', age: 1.3 },
//     ],
// }
```

The typing is applied after the data is evaluated, so the `.deon` file is parsed into `string`s, `list`s, and `map`s as usual, and the `.datasign` contract then converts the fields it declares. A field the contract does not mention is passed through untouched, an optional field (`nickname?: string`) may be absent, and a value that contradicts its declared type raises a `DEON_TYPE_MISMATCH`.

A declaration is what a value cannot be: `1.0` stays the `string` `'1.0'` when declared `string`, where the standalone [`typer`](#typing) would guess it into the number `1`.



## Deon for AI

[`@plurid/deon-mcp`][deon-mcp] serves `deon` over the [Model Context Protocol](https://modelcontextprotocol.io): a way for a language model to check the `deon` it writes, to read the `.deon` documents you have, and to use a `.deon` file as a prompt library.

``` bash
npx @plurid/deon-mcp --root ./configurations --prompts ./prompts.deon
```

**The language does not change.** There is no `infer` keyword, no resource kind which calls a model. It would slot neatly into the `import` machinery — and that is the temptation. A resource which asks a model for its value makes the same document parse to different values on different days, and a data notation whose value moves is not a data notation. `deon` describes; the model is asked elsewhere.

What *is* offered is what already fit.

**Tools.** A model writing `deon` gets it wrong, and has no way to find out; it has to guess whether the document it just produced is the document it meant. A `deon` [diagnostic](#diagnostics) carries a code, a line, and a column, so the loop closes: `deon_parse`, `deon_lint`, `deon_canonical`, `deon_stringify`, `deon_typed`, `deon_entities`. A refusal comes back as data rather than as prose, and says what is wrong and where, which is enough to fix it.

**Prompts.** A `.deon` file *is* a prompt library as it stands, and the fit is not a metaphor: an MCP prompt takes named arguments and they are strings; a `deon` [entity call](#interpolation) takes named arguments and they *must* be strings; and the arguments an entity demands are exactly the [interpolation](#interpolation) names it carries, which `deon` already computes. So the mapping is mechanical rather than a convention which could be got wrong.

``` deon
// ./prompts.deon
review `Review this #{language} code, focusing on #{focus}:

#{code}`

{
    review Review code for quality and bugs
}
```

The leaflinks are the templates, and the root map is the manifest — a key names an entity to expose, its value describes it. `prompts/list` then offers `review` with the required arguments `language`, `focus`, and `code`, which nothing declared: they were read out of the template. A leaflink the root does not name stays private to the library, exactly as it is private to a document.

**Resources.** The `.deon` files under the roots you named, served canonically, and nothing else.

The security model is the one the language already had. The [capability model](#parsing) denies the filesystem and the network unless they are asked for, which is ordinarily a nicety and here is load-bearing: a document's text becomes text a model reads, and a model acts on text it reads. So a document handed to a *tool* came from the model, is not trusted, and reaches nothing at all; a document under a *root* was named by a person, and may read the disk; and the network stays off, because a document which may `import` from an arbitrary URL is a way to put words a model will read into a channel nobody is watching.

The full account, including how to compose a shared preamble without it becoming an argument, is in the [`deon-mcp` documentation][deon-mcp].

[deon-mcp]: https://github.com/plurid/deon/tree/master/packages/tooling/deon-mcp



## In Use

`deon` is used in:

+ [`developer`](https://github.com/plurid/developer) - configuration file
+ [`delog`](https://github.com/plurid/delog) - configuration file
+ [`deserve`](https://github.com/plurid/deserve) - configuration file
+ [`joiner`](https://github.com/plurid/joiner) - configuration file
+ [`performer`](https://github.com/plurid/performer) - configuration file
+ [`pluridoc`](https://github.com/plurid/pluridoc) - plurid plane configuration



## Usages

`deon` can be plugged in into:

+ [`docker`](https://github.com/plurid/deon/tree/master/usages/docker)
+ [`kubectl`](https://github.com/plurid/deon/tree/master/usages/kubectl)



## Idiomaticity

It appears idiomatic to have three sections in a `.deon` file, ordered as:

+ imports;
+ root;
+ leaflinks.

The imports feel well-written when written in one line.

The root feels well-written when it has only one level of indentation, and every leaf is a `leaflink` (for `map`s or `list`s) or a `string`.

For example, the following [`joiner`](https://github.com/plurid/joiner) file:

``` deon
import otherPackages from ../../path/to/file


{
    #packages
    #package
    #commit
}


packages [
    one
    two
    ...#otherPackages
]

package {
    manager yarn
    publisher npm
}

commit {
    engine git
    combine true
    root packages
    fullFolder true
    divider ' > '
    message setup: package
}
```



## Specifics

### `JavaScript` / `TypeScript`

#### Parsing

The `JavaScript` / `TypeScript` can be used in the `NodeJS` runtime through the `Deon` object, or the `deon` template literal.

``` typescript
import Deon, {
    deon,
} from '@plurid/deon';
```

The parsing of `deon` data can be achieving asynchronously or synchronously

``` typescript
import Deon, {
    deon,
    deonSynchronous,
} from '@plurid/deon';

const main = async () => {
    const deonData = `
        {
            key value
        }
    `;

    const deonObject = new Deon();
    const parsedObjectAsynchronously = await deonObject.parse(deonData);
    const parsedObjectSynchronously = deonObject.parseSynchronous(deonData);

    const parsedTemplateAsynchronously = await deon`
        {
            key value
        }
    `;
    const parsedTemplateSynchronously = deonSynchronous`
        {
            key value
        }
    `;
}
```

Synchronous parsing is to be used when the `deon` data does not rely on `import` or `inject` features, naturally asynchronous operations. However, when the parsing operation is to be used in a blockable environment (such as the CLI), synchronous parsing can be used for `deon` data with `imports` and `injects` just as well as asynchronous parsing.

`deon` data can also be parsed in the browser, or other sandboxed environments, using the `DeonPure` object, or the `deonPure` template literal.

``` typescript
import {
    DeonPure,
    deonPure,
    deonPureSynchronous,
} from '@plurid/deon';


const main = async () => {
    const deonData = `
        {
            key value
        }
    `;

    const deonObject = new DeonPure();
    const parsedObjectAsynchronously = await deonObject.parse(deonData);
    const parsedObjectSynchronously = deonObject.parseSynchronous(deonData);

    const parsedTemplateAsynchronously = await deonPure`
        {
            key value
        }
    `;
    const parsedTemplateSynchronously = deonPureSynchronous`
        {
            key value
        }
    `;
}
```

The `deon` `Pure` implementation does not have access to the file system for `import` and `inject` features.


#### The methods

| Method | Reads | What it may reach |
| --- | --- | --- |
| `parse(text, options)` | a string | nothing, unless asked |
| `parseSynchronous(text, options)` | a string | nothing, unless asked |
| `parseFile(file, options)` | a file | the filesystem |
| `parseFileSynchronous(file, options)` | a file | the filesystem |
| `parseLink(link, options)` | a URL | the network, once `allowNetwork` says so |
| `leaflinks(text, options)` | a string | nothing, unless asked |
| `parseSyntax(text, sourceName)` | a string | nothing |
| `lint(text, sourceName)` | a string | nothing |
| `stringify(value, options)` | a value | nothing |
| `canonical(value)` | a value, or a string | nothing |
| `loadEnvironment(file, options)` | a file | the filesystem |

The capabilities are not granted alike, and the difference is the whole of the security model: handing over a *string* grants nothing at all, while handing over a *file* grants the filesystem, because you have already named a file. `parseFile` therefore turns on `allowFilesystem` for that file and for whatever it imports.

The network is never opened by any of them. It is opened by `allowNetwork`, and by nothing else — it is the option that grants the capability, never the method that was called. `parseLink` is no exception: naming a link is not the same as being allowed to reach it, so a `parseLink` without `allowNetwork` fails with `DEON_CAPABILITY_DENIED`, before any request is made.

``` typescript
// denied — the link was named, but the network was never asked for
await deon.parseLink('https://example.com/config.deon');

// allowed, and the document that comes back may import over the network in its turn
await deon.parseLink('https://example.com/config.deon', {
    allowNetwork: true,
});
```

`parseLink` caches according to `cache`, `cacheDuration`, and `cacheDirectory`, and sends `token` as a bearer credential. An empty token sends no header at all. The credential is part of the cache key, so a document read with one token is never handed to a reader holding another. A non-success status fails with `DEON_RESOURCE_IO`.

`parseSyntax` returns the syntax tree rather than the value, and `leaflinks` returns the declaration namespace already evaluated. Neither is needed to read data; they are what an editor reads to know where a thing is written and what a name would resolve to. `getSyntax` is an alias of `parseSyntax`.

#### Typing

In order to handle the typing of the `deon` parsed data the `typer` can be used, which handles the typing in the standard `JavaScript`/`TypeScript` fashion, or the `customTyper` can be used, which requires an aditional, custom `typing` function.

``` typescript
import Deon, {
    customTyper,
    typer,
} from '@plurid/deon';


const main = async () => {
    const deonData = `
        {
            keyBoolean true
            keyNumber 1
        }
    `;

    const deonObject = new Deon();
    // keyBoolean and keyNumber are typeof 'string'
    const parsedData = await deonObject.parse(deonData);

    // keyBoolean is typeof 'boolean' and keyNumber is typeof 'number'
    const defaultTypedData = typer(parsedData);

    // keyBoolean is typeof 'boolean' and keyNumber is typeof 'string'
    const customTypedData = customTyper(
        parsedData,
        (value) => {
            if (value === 'true') {
                return true;
            }

            return value;
        },
    );
}
```

#### Environment Loading

`deon` can be used to load environment variables at runtime from a `.deon` file.

Run the function call as soon as possible in the program.

``` deon
// env-file.deon
{
    ONE one
}
```

``` typescript
// index.ts
import Deon from '@plurid/deon';


const loadEnvironment = async () => {
    const deon = new Deon();

    // optional
    const options = {
        overwrite: false,
    };

    await deon.loadEnvironment(
        '/path/to/env-file.deon'
        options,
    );
}

const main = async () => {
    await loadEnvironment();

    console.log(process.env.ONE) // one
}

main();
```

The `.deon` file that will be used for environment variables can use all the features of `deon`, however the `root` must be comprised only of `string`s, or `list` of `string`s, other values will be ignored.


### Rust

In order to parse `deon` data the `Deon` implementation or the `deon!` macro can be used.

``` rust
use deon::{
    Deon,
    deon!,
}

fn main() {
    let deon_data = "
        {
            key value
        }
    ";

    let deon_object = Deon::new();
    let deon_object_parsed = Deon::parse(deon_data);

    let deon_macro_parsed = deon!(
        {
            key value
        }
    );
}
```



## Packages


<a target="_blank" href="https://marketplace.visualstudio.com/items?itemName=plurid.deon-grammar">
    <img src="https://img.shields.io/badge/vscode-v.0.0.8-1380C3?style=for-the-badge" alt="Version">
</a>

[@plurid/deon-grammar][deon-grammar] • `Visual Studio Code` syntax highlighting

[deon-grammar]: https://github.com/plurid/deon/tree/master/packages/tooling/deon-grammar/vscode



<a target="_blank" href="https://www.npmjs.com/package/@plurid/deon">
    <img src="https://img.shields.io/npm/v/@plurid/deon.svg?logo=npm&colorB=1380C3&style=for-the-badge" alt="NPM">
</a>

[@plurid/deon-javascript][deon-javascript] • `JavaScript` / `TypeScript` implementation

[deon-javascript]: https://github.com/plurid/deon/tree/master/packages/deon-javascript



<a target="_blank" href="https://crates.io/crates/deon">
    <img src="https://img.shields.io/crates/v/deon.svg?logo=npm&colorB=1380C3&style=for-the-badge" alt="NPM">
</a>

[@plurid/deon-rust][deon-rust] • `Rust` implementation

[deon-rust]: https://github.com/plurid/deon/tree/master/packages/deon-rust


<a target="_blank" href="https://pypi.org/project/deon">
    <img src="https://img.shields.io/pypi/v/deon.svg?logo=python&colorB=1380C3&style=for-the-badge" alt="PyPI">
</a>

[@plurid/deon-python][deon-python] • `Python` implementation

[deon-python]: https://github.com/plurid/deon/tree/master/packages/deon-python



<a target="_blank" href="https://www.npmjs.com/package/@plurid/deon-mcp">
    <img src="https://img.shields.io/npm/v/@plurid/deon-mcp.svg?logo=npm&colorB=1380C3&style=for-the-badge" alt="NPM">
</a>

[@plurid/deon-mcp][deon-mcp-package] • `Model Context Protocol` server

[deon-mcp-package]: https://github.com/plurid/deon/tree/master/packages/tooling/deon-mcp



## [Codeophon](https://github.com/ly3xqhl8g9/codeophon)

+ licensing: [delicense](https://github.com/ly3xqhl8g9/delicense)
+ versioning: [αver](https://github.com/ly3xqhl8g9/alpha-versioning)
