// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import Deon from '../../objects/Deon';
    // #endregion libraries
// #endregion imports



// #region module
export const readDeonFile = async <T = any>(
    path: string,
) => {
    try {
        const deon = new Deon();
        const data = await deon.parseFile<T>(path);

        return data;
    } catch (error) {
        return;
    }
}


export const writeDeonFile = async <T= any>(
    path: string,
    data: T,
) => {
    try {
        const deon = new Deon();
        const deonString = deon.stringify(data);

        await fs.writeFile(path, deonString);

        return true;
    } catch (error) {
        return false;
    }
}
// #endregion module
