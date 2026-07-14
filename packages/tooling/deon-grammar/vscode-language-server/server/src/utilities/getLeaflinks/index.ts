// #region imports
    // #region libraries
	import {
		internals,
		DeonInterpreterOptions,
	} from '@plurid/deon';
    // #endregion libraries
// #endregion imports



// #region module
const {
	Scanner,
	Parser,
	Interpreter,
} = internals;


const getLeaflinks = async (
	data: string,
	file: string,
) => {
	try {
		const error = () => {}

		const scanner = new Scanner(
			data,
			error,
		);
		const tokens = scanner.scanTokens();

		const parser = new Parser(
			tokens,
			error,
		);
		const statements = parser.parse();

		const interpretOptions: DeonInterpreterOptions = {
			file,
			parseOptions: {
			},
		};
		const interpreter = new Interpreter();
		await interpreter.interpret(
			statements,
			interpretOptions,
		);

		return interpreter.getLeaflinks();
	} catch (error) {
		console.log(error);
		return {};
	}
}
// #endregion module



// #region exports
export default getLeaflinks;
// #endregion exports
