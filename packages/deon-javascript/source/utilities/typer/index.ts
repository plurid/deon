// #region imports
    import {
        javascript,
    } from './typings';
// #endregion imports



// #region module
const customTyper = <T = any>(
    data: any,
    typing: (
        value: string,
    ) => any,
): T => {
    if (Array.isArray(data) || data instanceof Array) {
        const newArray: any[] = [];
        for (const element of data) {
            const newElement = customTyper(
                element,
                typing,
            );
            newArray.push(newElement);
        }
        return newArray as any;
    }

    if (typeof data === 'object') {
        const newData: any = {};
        for (const [key, value] of Object.entries(data)) {
            newData[key] = customTyper(
                value,
                typing,
            );
        }
        return newData;
    }

    if (typeof data === 'string') {
        const value = typing(
            data,
        );
        return value;
    }

    return data;
}


const typer = <T = any>(
    data: any,
): T => {
    const typedData = customTyper<T>(
        data,
        javascript,
    );

    return typedData;
}
// #endregion module



// #region exports
export {
    customTyper,
    typer,
};
// #endregion exports
