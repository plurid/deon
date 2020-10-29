<p align="center">
    <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
    <br />
    <br />
    <a target="_blank" href="https://github.com/plurid/deon/blob/master/LICENSE">
        <img src="https://img.shields.io/badge/license-MIT-blue.svg?colorB=1380C3&style=for-the-badge" alt="License: MIT">
    </a>
</p>



<h1 align="center">
    deon
</h1>


<h3 align="center">
    DeObject Notation Format
</h3>


<br />


`deon` is a notation format for structured strings.

`deon` is intended to be:

+ light on syntax — friendly for human read/write, should feel more like note-taking than data entry;
+ moderately fast — with a general use case for configuration-like files, loaded once at build/runtime;
+ programming-lite — although not a programming language, the in-file imports and the linking (in-file variables) give `deon` a programmatic feel.

The `deon` filename extension is `.deon`, and the media type is `application/deon`.

Why `deobject`? More of a play-on-words, although a case can be made considering the [linking](#linking) feature and the possible 'assembling' of the `root`, as if the object has been de-structured.


### Contents

+ [Example](#example)
+ [Implementations](#implementations)
+ [General](#general)
+ [Values](#values)
+ [Maps](#maps)
+ [Lists](#lists)
+ [Comments](#comments)
+ [Linking](#linking)
+ [Importing](#importing)
+ [Injecting](#injecting)
+ [Stringifying](#stringifying)
+ [Parsing](#parsing)
+ [Advanced Usage](#advanced-usage)
+ [In Use](#in-use)
+ [Usages](#usages)
+ [Idiomaticity](#idiomaticity)
+ [Packages](#packages)



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



## Stringifying

A `stringify` method is implemented in order to convert an in-memory data representation to string. A partial `options` object can be passed.

``` typescript
interface DeonStringifyOptions {
    readable: boolean;
    indentation: number;
    leaflinks: boolean;
    leaflinkLevel: number;
    leaflinkShortening: boolean;
    generatedHeader: boolean;
    generatedComments: boolean;
}
```



## Parsing

The `parse` method can receive the following partial options:

``` typescript
interface DeonParseOptions {
    absolutePaths: Record<string, string>,
    authorization: Record<string, string>,
    datasignFiles: string[];
    datasignMap: Record<string, string>;
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

const data = Deon.parse(
    deonFile,
    {
        // pass an array of all the .datasign files to be considered for type handling
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
```



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

+ [`kubectl`](https://github.com/plurid/deon/tree/master/usages/kubectl)



## Idiomaticity

It appears idiomatic to have three sections in a `.deon` file, ordered as:

+ imports;
+ root;
+ leaflinks.

The imports feel well-written when written in one line.

The root feels well-written when it has only one level of indentation, and every leaf is a `leaflink` (for `map`s or `list`s) or a `string`.

For example, the following [`.joiner`](https://github.com/plurid/joiner) file:

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



## Packages


<a target="_blank" href="https://github.com/plurid/deon/tree/master/packages/deon-grammar/vscode">
    <img src="https://img.shields.io/badge/vscode-v.0.0.5-1380C3?style=for-the-badge" alt="Version">
</a>

[@plurid/deon-grammar][deon-grammar] • `Visual Studio Code` syntax highlighting

[deon-grammar]: https://github.com/plurid/deon/tree/master/packages/deon-grammar/vscode



<a target="_blank" href="https://www.npmjs.com/package/@plurid/deon">
    <img src="https://img.shields.io/npm/v/@plurid/deon.svg?logo=npm&colorB=1380C3&style=for-the-badge" alt="NPM">
</a>

[@plurid/deon-javascript][deon-javascript] • `JavaScript` / `TypeScript` implementation

[deon-javascript]: https://github.com/plurid/plurid/tree/master/packages/deon-javascript
