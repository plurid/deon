# kubectl


Use `.deon` files with `kubectl` to `apply` configurations to the Kubernetes cluster.

The script leverages the [`kubectl` plugins](https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/) mechanism.

In order to use the `kubectl-deonly` script, rename the source with copy, make it an executable, move it to the binaries folder.

``` bash
cp ./source/kubectl-deonly-source.js ./source/kubectl-deonly

sudo chmod +x ./source/kubectl-deonly

sudo mv ./source/kubectl-deonly /usr/local/bin
```

The name `kubectl-deonly` is a play on `deon` + `apply` and can be changed to anything else following the pattern `kubectl-name`.

`kubectl-deonly` leverages the [`NodeJS`](https://nodejs.org) runtime and the [`@plurid/deon`](https://www.npmjs.com/package/@plurid/deon) NPM package. Ensure that they are properly installed before using `kubectl-deonly`.


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
