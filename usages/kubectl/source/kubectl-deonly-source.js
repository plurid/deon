#!/usr/local/bin/node


const {
    promises: fs,
} = require('fs');



const typeData = (
    data,
    Deon,
) => {
    const {
        typer,
    } = Deon;

    return typer(data);
}


const handleFile = async (
    file,
    Deon,
) => {
    try {
        const deon = new Deon.default();
        const parsedData = await deon.parseFile(file);
        const typedData = typeData(
            parsedData,
            Deon,
        );

        return JSON.stringify(typedData);
    } catch (error) {
        console.log(`Could not read file: ${file}`);
    }
}


const main = async () => {
    try {
        const {
            execSync,
         } = require('child_process');

        const root = execSync('npm root -g')
            .toString()
            .trim();


        const Deon = require(`${root}/@plurid/deon`);

        const files = process.argv.slice(2);

        if (files.length === 0) {
            console.log(`No .deon files specified to be applied to the cluster.`);

            return;
        }

        const parsedData = [];

        for (const file of files) {
            const data = await handleFile(
                file,
                Deon,
            );
            if (data) {
                parsedData.push(data);
            }
        }

        for (const data of parsedData) {
            const kubectlApply = `echo '${data}' | kubectl apply -f -`;
            execSync(
                kubectlApply,
                {
                    stdio: 'inherit',
                },
            );
        }

        return;
    } catch (error) {
        console.log(`Something went wrong. Ensure that '@plurid/deon' is installed and functional · https://manual.plurid.com/deon/getting-started`);
    }
}


main();
