const Deon = require('../../distribution').default;



const main = async () => {
    const deon = new Deon();
    const data = await deon.parseLink(
        'https://raw.githubusercontent.com/plurid/deon/master/packages/deon-javascript/tests/simple/list.deon',
        {
            cache: true,
        },
    );

    console.log(data);
}

main();
