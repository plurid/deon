# kubectl



## About

Use `.deon` files with `kubectl` to `apply` configurations to the Kubernetes cluster.

The script leverages the [`kubectl` plugins](https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/) mechanism.


## Install

In order to setup the `kubectl-deonly` script, rename the source with copy, check interpreter path, make it an executable, move it to the binaries folder.

``` bash
LANGUAGE_FILE=""
LANGUAGE_INTERPRETER=""

cp ./source/kubectl-deonly-source-$LANGUAGE_FILE ./source/kubectl-deonly

INTERPRETER=`which $LANGUAGE_INTERPRETER`
echo $INTERPRETER
head -1 ./source/kubectl-deonly

# if INTERPRETER does not equal head, replace the value
sed -i "1s+.*+\#\!$INTERPRETER+" ./source/kubectl-deonly

sudo chmod +x ./source/kubectl-deonly

sudo mv ./source/kubectl-deonly /usr/local/bin
```

where `LANGUAGE_X` is the appropriate implementation:

+ NodeJS:
    + `LANGUAGE_FILE`: `node.js`
    + `LANGUAGE_INTERPRETER`: `node`

The name `kubectl-deonly` is a play on `deon` + `apply` and can be changed to anything else following the pattern `kubectl-name`.

`kubectl-deonly` NodeJS leverages the [`NodeJS`](https://nodejs.org) runtime and the [`@plurid/deon`](https://www.npmjs.com/package/@plurid/deon) NPM package. Ensure that they are properly installed before using `kubectl-deonly`.


## Use

Commands can be issued with

``` bash
kubectl deonly file.deon
```

Multiple files can be applied at the same time by chaining with space the filenames

``` bash
kubectl deonly ./relative/file1.deon /absolute/file.deon
```

The `.deon` extension can be omitted from the filename.

``` bash
kubectl deonly file
```
