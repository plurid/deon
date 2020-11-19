// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';
    // #endregion libraries


    // #region external
    import {
        log,
    } from '../log';

    import {
        removeEndDoubleNewline,
        resolveAbsolutePath,
    } from '../general';

    import {
        typer,
    } from '../typer';
    // #endregion external
// #endregion imports



// #region module
const handleFileOutput = (
    data: any,
    dataAsString: string,
    options: any,
) => {
    switch (options.output) {
        case 'deon': {
            const deonValue = dataAsString;
            const value = removeEndDoubleNewline(deonValue);
            log(value);
            break;
        }
        case 'json': {
            if (options.typed) {
                log(
                    JSON.stringify(
                        typer(data),
                        null,
                        4,
                    ),
                );
            } else {
                log(
                    JSON.stringify(
                        data,
                        null,
                        4,
                    ),
                );
            }
            break;
        }
        default:
            console.log(`Deon :: Unsupported output '${options.output}'.`);
            break;
    }
}


const handleConvert = async (
    destination: string | undefined,
    data: string,
) => {
    if (destination) {
        const filepathDestination = resolveAbsolutePath(destination);

        await fs.writeFile(
            filepathDestination,
            data,
        );
    } else {
        const value = removeEndDoubleNewline(data);
        console.log(value);
    }
}
// #endregion module



// #region exports
export {
    handleFileOutput,
    handleConvert,
};
// #endregion exports
