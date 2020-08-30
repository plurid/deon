// #region module
const mapToObject = <K, V>(
    map: Map<K, V>,
) => {
    let obj: any = {};

    for (let [k,v] of map) {
        obj[k] = v;
    }

    return obj;
}
// #endregion module



// #region exports
export {
    mapToObject,
};
// #endregion exports
