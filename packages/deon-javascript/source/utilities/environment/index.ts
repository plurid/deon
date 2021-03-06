// #region imports
    // #region libraries
    import {
        spawn,
    } from 'child_process';
    // #endregion libraries


    // #region external
    import {
        DeonLoadEnvironmentOptions,
    } from '../../data/interfaces';
    // #endregion external
// #endregion imports



// #region module
const verifyEnvironmentData = (
    data: any,
) => {
    if (!data) {
        return false;
    }

    if (Array.isArray(data)) {
        return false;
    }

    if (typeof data !== 'object') {
        return false;
    }

    return true;
}


const cleanEnvironmentData = (
    data: any,
) => {
    const verification = verifyEnvironmentData(data);

    if (!verification) {
        return;
    }

    const cleanData: any = {};

    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            cleanData[key] = value;
            continue;
        }

        if (Array.isArray(value)) {
            const isNotStringArray = value.some(item => typeof item !== 'string');

            if (isNotStringArray) {
                continue;
            }

            cleanData[key] = value.join(' ');
        }
    }

    return cleanData;
}


const setEnvironment = (
    data: any,
    overwrite?: boolean,
) => {
    const cleanData = cleanEnvironmentData(data);

    if (!cleanData) {
        return;
    }

    Object.keys(cleanData).forEach((key) => {
        const value = cleanData[key];

        if (typeof value !== 'string') {
            return;
        }

        if (
            !Object.prototype.hasOwnProperty.call(process.env, key)
        ) {
            process.env[key] = value;
            return;
        }

        if (overwrite) {
            process.env[key] = value;
            return;
        }

        console.log(`'${key}' is already defined.`);
    });
}


const spawnEnvironmentCommand = (
    command: string[],
    data: any,
    options: DeonLoadEnvironmentOptions,
) => {
    const cleanData = cleanEnvironmentData(data);

    if (!cleanData) {
        return;
    }

    const env: any = {
        ...process.env,
    };

    Object.entries(data).map(([key, value]) => {
        if (typeof value !== 'string') {
            return;
        }

        if (
            env[key]
            && !options.overwrite
        ) {
            return;
        }

        env[key] = value;
    });

    // Based on cross-env
    // https://github.com/kentcdodds/cross-env/blob/master/src/index.js
    const proc = spawn(
        command[0],
        command.slice(1),
        {
            stdio: 'inherit',
            env,
        },
    );

    process.on('SIGTERM', () => proc.kill('SIGTERM'))
    process.on('SIGINT', () => proc.kill('SIGINT'))
    process.on('SIGBREAK', () => proc.kill('SIGBREAK'))
    process.on('SIGHUP', () => proc.kill('SIGHUP'))
    proc.on('exit', (code, signal) => {
        let crossEnvExitCode = code
        // exit code could be null when OS kills the process(out of memory, etc) or due to node handling it
        // but if the signal is SIGINT the user exited the process so we want exit code 0
        if (crossEnvExitCode === null) {
            crossEnvExitCode = signal === 'SIGINT' ? 0 : 1
        }
        process.exit(crossEnvExitCode); //eslint-disable-line no-process-exit
    });
    return proc;
}
// #endregion module



// #region exports
export {
    setEnvironment,
    spawnEnvironmentCommand,
};
// #endregion exports
