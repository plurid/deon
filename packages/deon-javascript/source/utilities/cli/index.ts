// #region imports
    // #region libraries
    import {
        promises as fs,
    } from 'fs';

    import path from 'path';
    // #endregion libraries


    // #region external
    import {
        ConfiledFile,
    } from '../../data/interfaces';

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

    import Deon from '../../objects/Deon';
    import Stringifier from '../../objects/Stringifier';
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


const handleConfile = async (
    files: string[],
    destination: string,
) => {
    const filesData: Record<string, ConfiledFile> = {};

    for (const file of files) {
        try {
            const filepath = path.isAbsolute(file)
                ? file
                : path.join(
                    process.cwd(),
                    file,
                );

            const data = await fs.readFile(filepath, 'utf-8');

            const confiledFile = {
                data,
            };

            filesData[file] = confiledFile;
        } catch (error) {
            console.log(`Deon :: Could not read '${file}'.`);
        }
    }

    try {
        const destinationPath = path.isAbsolute(destination)
            ? destination
            : path.join(
                process.cwd(),
                destination,
            );

        const stringifier = new Stringifier();
        const deonString = stringifier.stringify(filesData);

        await fs.writeFile(destinationPath, deonString);
    } catch (error) {
        console.log(`Deon :: Could not write '${destination}'.`);
    }
}


const handleExfile = async (
    source: string,
) => {
    try {
        const deon = new Deon();
        const data: any = await deon.parseFile(source);

        for (const [filepath, confile] of Object.entries(data)) {
            try {
                const filedata: any = confile;

                if (typeof filedata === 'string') {
                    await fs.writeFile(filepath, filedata);
                    continue;
                }

                await fs.writeFile(filepath, filedata.data);
            } catch (error) {
                console.log(`Deon :: Could not write '${filepath}'.`);
            }
        }
    } catch (error) {
        console.log(`Deon :: Could not exfile '${source}'.`);
    }
}
// #endregion module



// #region exports
export {
    handleFileOutput,
    handleConvert,
    handleConfile,
    handleExfile,
};
// #endregion exports
