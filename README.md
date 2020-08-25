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

The file extensions can be `.deon` or `.don`.


### Contents

+ [Example](#example)
+ [General](#general)
+ [Values](#values)
+ [Maps](#maps)
+ [Lists](#lists)
+ [Comments](#comments)
+ [Linking](#linking)



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

A `deon` file has a `root` which can be a `map` or a `list`, and multiple `leaflinks` which can be `string` values, `map`s or `list`s.

In `deon` every endleaf value is a `string`. It is up to the consumer to make the type conversions required.

`deon` supports two types of value groupings, the `map` and the `list`.



## Values

A `value` can be surrounded in singlequotes `'` in order to support special characters, such as trailing spaces

``` deon
{
    key 'value with 4 trailing spaces    '
}
```


Multi-line values use the backtick <code>`</code>. The multi-line string is stripped of any space or new lines before the first characters and after the last character.


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

The `mapKey` is an `A-Za-z0-9_-` string of characters. To support special characters (such as space), the `mapKey` must be surrounded by single quotes, such as

``` deon
mapName {
    'map Key' mapValue
}
```

The `mapValue` starts after the space of the `mapKey` and continues until the end of the line, until a comma, or at the space before the in-line comments (if any).


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

The `list` value grouping starts at the first non-space character of the new line and ends at the end of line, at the comma, or at the space before the in-line comments (if any).

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

A link is designated using the hash sign `#`.

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

To support linking with special characters in name, the leaflink must be surrounded by singlequotes `'`.


``` deon
{
    #'key with spaces'
}

'key with spaces' value
```
