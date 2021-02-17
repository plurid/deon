# docker


Generate `dockerfile`s from `.deon` files.

In order to use the `docker-deon` script, rename the source with copy, check interpreter path, make it an executable, move it to the binaries folder.

``` bash
LANGUAGE_FILE=""
LANGUAGE_INTERPRETER=""

cp ./source/docker-deon-source-$LANGUAGE_FILE ./source/docker-deon

INTERPRETER=`which $LANGUAGE_INTERPRETER`
echo $INTERPRETER
head -1 ./source/docker-deon

# if INTERPRETER does not equal head
sed -i "1s+.*+\#\!$INTERPRETER+" ./source/docker-deon

sudo chmod +x ./source/docker-deon

sudo mv ./source/docker-deon /usr/local/bin
```

where `[language-x]` is the appropriate implementation:

+ NodeJS:
    + `LANGUAGE_FILE`: `node.js`
    + `LANGUAGE_INTERPRETER`: `node`

`docker-deon` NodeJS leverages the [`NodeJS`](https://nodejs.org) runtime and the [`@plurid/deon`](https://www.npmjs.com/package/@plurid/deon) NPM package. Ensure that they are properly installed before using `docker-deon`.


Commands can be issued with

``` bash
docker-deon <path/to/source/file.deon> <path/to/generated/dockerfile>
```
