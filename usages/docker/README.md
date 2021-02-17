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

# if INTERPRETER does not equal head, replace the value
sed -i "1s+.*+\#\!$INTERPRETER+" ./source/docker-deon

sudo chmod +x ./source/docker-deon

sudo mv ./source/docker-deon /usr/local/bin
```

where `LANGUAGE_X` is the appropriate implementation:

+ NodeJS:
    + `LANGUAGE_FILE`: `node.js`
    + `LANGUAGE_INTERPRETER`: `node`

`docker-deon` NodeJS leverages the [`NodeJS`](https://nodejs.org) runtime and the [`@plurid/deon`](https://www.npmjs.com/package/@plurid/deon) NPM package. Ensure that they are properly installed before using `docker-deon`.


Commands can be issued with

``` bash
docker-deon <path/to/source/file.deon> <path/to/generate/dockerfile>
```

The `docker` `.deon` source file is comprised of a `deon` list at the root-level, using all the other `deon` features ([imports](https://github.com/plurid/deon#importing), [leaflinks](https://github.com/plurid/deon#linking), etc.).

Each item of the root list is considered a `docker` stage. A stage can be specified using a `deon` list of literals, e.g., `FROM imagene:version`, or a special `deon` map following the interface

``` typescript
interface DockerDeonStageMap {
    imagene: string;

    /**
     * Build arguments, `ARG`.
     */
    arguments?: string[];

    /**
     * Map of the environment.
     */
    environment?: Record<string, string>;

    /**
     * Working directory, `WORKDIR`.
     */
    directory?: string;

    /**
     * Actionable commands such as `COPY`, `RUN`.
     */
    actions?: string[];

    /**
     * Any kind of valid `Dockerfile` literal.
     */
    literals?: string[];

    /**
     * Imagene command, `CMD`.
     */
    command?: string[];
}
```
