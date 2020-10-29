// #region imports
    // #region external
    import Deon from '../';

    import {
        log,
    } from '../../../utilities/log';

    import {
        typer,
    } from '../../../utilities/typer';

    import {
        compareTimeBenchmark,
        suites,
    } from '../../../utilities/test';
    // #endregion external
// #endregion imports



// #region module
describe(suites.examples, () => {
    it('initial', async () => {
        const dataValues = `
{
    entities [
        {
            id 01
            name One
            active true
        }
        {
            id 02
            name Two
            active false
        }
    ]
    #time
}

time 1598439736
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(2);
        expect(data.time).toEqual('1598439736');
        expect(data.entities.length).toEqual(2);
        expect(data.entities[0].id).toEqual('01');
        expect(data.entities[0].name).toEqual('One');
        expect(data.entities[0].active).toEqual('true');
        expect(data.entities[1].id).toEqual('02');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.examples} - initial`,
        );
    });


    it('performer', async () => {
        const dataValues = `
// a .deon file
{
    stages [
        {
            name Setup NPM Private Access
            directory /path/to/package
            imagene ubuntu
            command [
                /bin/bash
                ./configurations/.npmrc.sh
            ]
            secretsEnvironment [
                NPM_TOKEN
            ]
        }
        {
            name Generate the Imagene
            directory /path/to/package
            imagene docker
            command [
                build
                -f
                ./configurations/docker.development.dockerfile
                -t
                hypod.cloud/package-name:$SHORT_SHA
                .
            ]
        }
        {
            name Push Imagene to Registry
            directory /path/to/package
            imagene docker
            command [
                push
                hypod.cloud/package-name:$SHORT_SHA
            ]
        }
    ]
    timeout 720
}
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(2);
        expect(data.timeout).toEqual('720');
        expect(data.stages.length).toEqual(3);
        expect(data.stages[1].command[3]).toEqual('-t');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.examples} - performer`,
        );
    });


    it('linked performer', async () => {
        const dataValues = `
// a .deon file

// the root
{
    stages [
        #stage1
        #stage2
        #stage3
    ]
    timeout 720
}


// the leaflinks
stage1 {
    name Setup NPM Private Access
    #directory
    imagene ubuntu
    command #commands.stage1
    #secretsEnvironment
}

stage2 {
    name Generate the Imagene
    #directory
    imagene docker
    command #commands.stage2
}

stage3 {
    name Push Imagene to Registry
    #directory
    imagene docker
    command #commands.stage3
}

directory /path/to/package

commands {
    stage1 [
        /bin/bash
        ./configurations/.npmrc.sh
    ]
    stage2 [
        build
        -f
        ./configurations/docker.development.dockerfile
        -t
        #imageneName
        .
    ]
    stage3 [
        push
        #imageneName
    ]
}

secretsEnvironment [
    NPM_TOKEN
]

imageneName hypod.cloud/package-name:$SHORT_SHA
        `;

        const start = Date.now();
        const deon = new Deon();
        const data = await deon.parse(
            dataValues,
        );
        const end = Date.now();
        // log(data);


        expect(Object.keys(data).length).toEqual(2);
        expect(data.timeout).toEqual('720');
        expect(data.stages.length).toEqual(3);
        expect(data.stages[1].command[3]).toEqual('-t');

        compareTimeBenchmark(
            start,
            end,
            'fast',
            `${suites.examples} - linked performer`,
        );
    });
});
// #endregion module
