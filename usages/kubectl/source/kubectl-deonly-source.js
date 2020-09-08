#!/usr/local/bin/node


const {
    promises: fs,
} = require('fs');




const handleKubernetesConfiguration = (
    data,
) => {
    // loop over the fields and convert number to number, boolean to booleans
    return data;
}


const handleFile = async (
    file,
    deon,
) => {
    try {
        const parsedData = await deon.parseFile(file);
        const typedData = handleKubernetesConfiguration(parsedData);

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


        const Deon = require(`${root}/@plurid/deon`).default;

        const deon = new Deon();

        const files = process.argv.slice(2);

        if (files.length === 0) {
            console.log(`No .deon files specified to be applied to the cluster.`);

            return;
        }

        const parsedData = [];

        for (const file of files) {
            const data = await handleFile(
                file,
                deon,
            );
            if (data) {
                parsedData.push(data);
            }
        }

        for (const data of parsedData) {
            const kubectlApply = `${data} | kubectl apply -f -`;
            console.log(kubectlApply);
            // execSync(kubectlApply);
        }

        return;
    } catch (error) {
        console.log(`Something went wrong. Ensure that '@plurid/deon' is installed and functional · https://manual.plurid.com/deon/getting-started`);
    }
}


main();
