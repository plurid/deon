<p align="center">
    <img src="https://raw.githubusercontent.com/plurid/deon/master/about/identity/deon-logo.png" height="250px">
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
</h1>


`deon` is a notation format for structured strings.

The `deon` file extension is `.deon`.


### Contents

+ [Example](#example)
+ [General](#general)
+ [Values](#values)
+ [Maps](#maps)
+ [Lists](#lists)
+ [Comments](#comments)
+ [Linking](#linking)
+ [Importing](#importing)
+ [Stringifying](#stringifying)
+ [Advanced Usage](#advanced-usage)



## Example

Consider the following commonly-used formats with an example file from [`performer`](https://github.com/plurid/performer):


``` yaml
---
# an .yaml file
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

- name: 'Push Container to Container Registry'
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
      "name": "Push Container to Container Registry",
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
    command #stage1Command
    #secretsEnvironment
}

stage2 {
    name Generate the Imagene
    #directory
    imagene docker
    command #stage2Command
}

stage3 {
    name Push Imagene to Registry
    #directory
    imagene docker
    command #stage3Command
}

directory /path/to/package

stage1Command [
    /bin/bash
    ./configurations/.npmrc.sh
]

stage2Command [
    build
    -f
    ./configurations/docker.development.dockerfile
    -t
    #imageneName
    .
]

stage3Command [
    push
    #imageneName
]

secretsEnvironment [
    NPM_TOKEN
]

imageneName hypod.cloud/package-name:$SHORT_SHA
```



## General

A `deon` is comprised of a required `root` and none or more, optional `leaflink`s.

In `deon` every endleaf value is a `string`. It is up to the consumer to handle the required type conversions based on the problem domain interface. An [advanced use case](#advanced-usage) couples `deon` with [`datasign`](https://github.com/plurid/datasign) to handle type conversions.

`deon` supports two types of value groupings, the `map` and the `list`.

The `root` can be a `map` or a `list`.

The `leaflink`s can be `string` values, `map`s or `list`s.

A `map` can have `list`s as values. A `list` can have `map`s as values.

The order of the `root` or of any of the `leaflink`s is not important.

The per `map` `key` names and the `leaflink` `map` names are expected to be unique.



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

The `map` is comprised of key-value pairs. The `deon` `root` is the single `map` without a `mapName`.

The `mapKey` is an `A-Za-z0-9_-` string of characters. To support special characters (such as space), the `mapKey` must be surrounded by single quotes, such as

``` deon
mapName {
    'map Key' mapValue
}
```

The `mapValue` starts after the space of the `mapKey` and continues until the end of the line or until a comma.


``` deon
mapName {
    mapKey1 mapValue1
    mapKey2 mapValue2
}
```

or

``` deon
mapName {
    mapKey1 mapValue1, mapKey2 mapValue2
}
```



## Lists

``` deon
listName [
    listValue1
    listValue2
]
```

The `list` value grouping starts at the first non-space character after the left square bracket `[`, or after the previous list item, and ends at the end of line or at the comma.

Such as

``` deon
listName [
    listValue1, listValue2
]
```

or

``` deon
listName [listValue1, listValue2]
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



## Importing

A `.deon` file can import another `.deon` file using the following syntax

``` deon
import <name> from <path>
```

Where the `name` is an arbitrary string, and the `path` is the path of the targeted `.deon` file.

The import imports the `root` from the targeted `.deon` file in order to be used as a regular, locally-defined `leaflink`.

The import statement order in file is not important. Imports will be resolved primarily, before any other action. The import `name` must be unique among all the other imports and among the locally-defined `leaflink`s, given that there is no discernible conceptual difference between them.


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

A `path` can also be an `URL` such as

``` deon
import urlFile from https://example.com/url-file.deon
```

In order to request `URL` files from protected routes, an `authorization` `map` of authorization `token`s can be passed at parse-time with all the domains required by the imports

``` deon
authorization {
    example.com token
}
```

with the `token` being passed into the `Authorization: Bearer <token>` header of the adequate domain at request-time.



## Stringifying

A `stringify` method is implemented in order to convert an in-memory data representation to string. An `options` object can be passed.

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
