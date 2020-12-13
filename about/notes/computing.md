# Possible Universal Computing Syntax

``` deon
{
    aKey1 (one ) + (two)        // 'one two'
    aKey2 (value).slice(1, 2)   // 'a'
    aKey3 (value).reverse()     // 'eulav'
    aKey4 (words).one()         // 'sdrow'
    aKey5 (#four).one()         // [ 'two' ]
}

four [
    one
    two
]

one (
    two
) {
    someVariable value
    someList [
        value
    ]
    someMap {
        key value
    }

    (#two)
        .isString() // '()' are optional when calling without arguments
        .reverse()

    (#two)
        .isList()
        .slice(1)

    (#two)
        .isMap()
        .replace(#someMap)
}


looping (
    word
) {
    (#word)
        .equals(one)

    (#word)
        .isString()
        .looping()
}


two {
    three {
        four () {}
    }
}

nested () {
    (#two).two.three.four()
}
```
